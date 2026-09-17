import { type PendingDocumentLoad } from '@ordens/contracts';
import { Prisma, type Tx, type UnitOfWorkScope } from '@ordens/db';
import { currentAuth } from '../../common/request-context.js';
import { fiscalChecklists } from '../logistics/fiscal-checklist.js';
import { recalcOrder } from '../logistics/logistics.util.js';

/** Cargas não canceladas da ordem cuja documentação fiscal da Fazenda ainda não está completa (Q45). */
export async function pendingFiscalDocuments(tx: Tx, orderId: string): Promise<PendingDocumentLoad[]> {
  const loads = await tx.load.findMany({
    where: { orderId, status: { not: 'CANCELLED' } },
    select: { id: true, number: true, status: true, grossKg: true, tareKg: true },
    orderBy: { sequence: 'asc' },
  });
  if (!loads.length) return [];
  const checklists = await fiscalChecklists(tx, loads, true);
  return loads
    .filter((l) => !checklists.get(l.id)?.ready)
    .map((l) => ({
      id: l.id,
      number: l.number,
      issues: checklists.get(l.id)?.issues.length ? checklists.get(l.id)!.issues : ['Documentação fiscal não validada.'],
    }));
}

/**
 * Conclusão automática (Q45): ordem em execução com todas as cargas encerradas, nenhum agendamento em aberto,
 * documentação fiscal completa e quantidade atingida dentro da tolerância.
 */
export async function canAutoComplete(tx: Tx, orderId: string): Promise<boolean> {
  const order = await tx.loadingOrder.findUniqueOrThrow({ where: { id: orderId } });
  if (order.status !== 'IN_PROGRESS' || order.quantity === null) return false;
  const [openLoads, openAppointments] = await Promise.all([
    tx.load.count({ where: { orderId, status: { notIn: ['COMPLETED', 'CANCELLED'] } } }),
    tx.appointment.count({ where: { orderId, status: { in: ['REQUESTED', 'CONFIRMED', 'CHECKED_IN'] } } }),
  ]);
  if (openLoads || openAppointments) return false;
  const minimum = new Prisma.Decimal(order.quantity).times(new Prisma.Decimal(1).minus(new Prisma.Decimal(order.tolerancePct).dividedBy(100)));
  if (new Prisma.Decimal(order.loadedQty).plus(order.cancelledQty).lessThan(minimum)) return false;
  return (await pendingFiscalDocuments(tx, orderId)).length === 0;
}

export interface CompletionInfo {
  reason: string | null;
  acceptedPendingDocuments: boolean;
  via: 'manual' | 'auto';
  previousStatus: 'PUBLISHED' | 'IN_PROGRESS';
  number: string;
  balance: string;
}

/**
 * Grava a conclusão (manual ou automática): cancela agendamentos e liberações ativos que perderam a
 * finalidade, audita e publica o aviso — tudo na mesma transação.
 */
export async function completeOrderRecord(scope: UnitOfWorkScope, id: string, info: CompletionInfo): Promise<void> {
  const { tx } = scope;
  const userId = currentAuth().userId;
  const now = new Date();
  const note = info.reason ? `Ordem concluída: ${info.reason}` : 'Ordem concluída';
  const appointments = await tx.appointment.updateMany({
    where: { orderId: id, status: { in: ['REQUESTED', 'CONFIRMED', 'CHECKED_IN'] } },
    data: { status: 'CANCELLED', cancelReason: note },
  });
  const releases = await tx.loadingOrderRelease.updateMany({
    where: { orderId: id, status: 'ACTIVE' },
    data: { status: 'CANCELLED', cancelledAt: now, cancelledBy: userId, cancelReason: note },
  });
  await tx.loadingOrder.update({
    where: { id },
    data: { status: 'COMPLETED', completedAt: now, completedBy: userId, completionReason: info.reason, completionVia: info.via, updatedBy: userId },
  });
  await recalcOrder(tx, id);
  await scope.audit({
    entityType: 'loading_order',
    entityId: id,
    action: 'order.completed',
    before: { status: info.previousStatus },
    after: {
      status: 'COMPLETED',
      via: info.via,
      reason: info.reason,
      balance: info.balance,
      acceptedPendingDocuments: info.acceptedPendingDocuments,
      appointmentsCancelled: appointments.count,
      releasesCancelled: releases.count,
    },
  });
  await scope.outbox({
    type: 'order.completed',
    aggregateType: 'loading_order',
    aggregateId: id,
    payload: { orderId: id, number: info.number, via: info.via, reason: info.reason, balance: info.balance },
  });
}

/** Chamado após encerrar uma carga: conclui a ordem sozinha quando nada mais está pendente. */
export async function autoCompleteIfFinished(scope: UnitOfWorkScope, orderId: string): Promise<boolean> {
  if (!(await canAutoComplete(scope.tx, orderId))) return false;
  const order = await scope.tx.loadingOrder.findUniqueOrThrow({
    where: { id: orderId },
    select: { number: true, quantity: true, loadedQty: true, cancelledQty: true },
  });
  const balance = Prisma.Decimal.max(new Prisma.Decimal(order.quantity ?? 0).minus(order.loadedQty).minus(order.cancelledQty), 0);
  await completeOrderRecord(scope, orderId, { reason: null, acceptedPendingDocuments: false, via: 'auto', previousStatus: 'IN_PROGRESS', number: order.number, balance: balance.toString() });
  return true;
}
