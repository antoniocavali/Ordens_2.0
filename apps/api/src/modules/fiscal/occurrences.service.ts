import { Injectable } from '@nestjs/common';
import {
  canTransitionOccurrence,
  ErrorCode,
  OCCURRENCE_SEVERITIES,
  OCCURRENCE_STATUS_LABELS,
  OCCURRENCE_STATUSES,
  OCCURRENCE_TRANSITIONS,
  OCCURRENCE_TYPES,
  occurrenceInputSchema,
  occurrenceTransitionSchema,
  occurrenceUpdateSchema,
  type DocumentVisibility,
  type OccurrenceDto,
  type OccurrenceListQuery,
  type OccurrenceStatus,
  type Page,
  type Scope,
} from '@ordens/contracts';
import type { Prisma, Tx } from '@ordens/db';
import type { z } from 'zod';
import { AppError } from '../../common/errors.js';
import { currentAuth } from '../../common/request-context.js';
import { TenantDb } from '../../infra/tenant-db.service.js';
import { fromDate, toDate } from '../registry/registry.util.js';
import { oneOf, openOccurrence, uniq } from './fiscal.util.js';

type OccurrenceRow = NonNullable<Awaited<ReturnType<Tx['occurrence']['findUnique']>>>;
type CreateInput = z.output<typeof occurrenceInputSchema>;
type UpdateInput = z.output<typeof occurrenceUpdateSchema>;
type TransitionInput = z.output<typeof occurrenceTransitionSchema>;

const CLOSED: OccurrenceStatus[] = ['RESOLVED', 'CANCELLED'];

/** Fazenda sempre enxerga o que abre ou edita (Q14). */
function visibilityFor(scope: Scope, visibility: DocumentVisibility): DocumentVisibility {
  return scope === 'FARM' && visibility !== 'FARM' && visibility !== 'PARTIES' ? 'FARM' : visibility;
}

const snapshot = (r: Pick<OccurrenceRow, 'type' | 'severity' | 'title' | 'description' | 'visibility' | 'responsibleUserId' | 'dueOn'>) => ({
  type: r.type,
  severity: r.severity,
  title: r.title,
  description: r.description,
  visibility: r.visibility,
  responsibleUserId: r.responsibleUserId,
  dueOn: fromDate(r.dueOn),
});

@Injectable()
export class OccurrencesService {
  constructor(private readonly db: TenantDb) {}

  list(q: OccurrenceListQuery): Promise<Page<OccurrenceDto>> {
    return this.db.read(async (tx) => {
      const status = oneOf(OCCURRENCE_STATUSES, q.status);
      const type = oneOf(OCCURRENCE_TYPES, q.type);
      const severity = oneOf(OCCURRENCE_SEVERITIES, q.severity);
      const where: Prisma.OccurrenceWhereInput = {
        ...(status?.length ? { status: { in: status } } : {}),
        ...(type?.length ? { type: { in: type } } : {}),
        ...(severity?.length ? { severity: { in: severity } } : {}),
        ...(q.orderId ? { orderId: q.orderId } : {}),
        ...(q.loadId ? { loadId: q.loadId } : {}),
        ...(q.q ? { OR: [{ number: { contains: q.q, mode: 'insensitive' } }, { title: { contains: q.q, mode: 'insensitive' } }] } : {}),
      };
      const [total, rows] = await Promise.all([
        tx.occurrence.count({ where }),
        tx.occurrence.findMany({ where, orderBy: [{ status: 'asc' }, { createdAt: 'desc' }], skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      ]);
      return { total, page: q.page, pageSize: q.pageSize, items: await this.toDtos(tx, rows) };
    });
  }

  detail(id: string): Promise<OccurrenceDto> {
    return this.db.read((tx) => this.dto(tx, id));
  }

  create(input: CreateInput): Promise<OccurrenceDto> {
    const auth = currentAuth();
    const scopeName = auth.membership!.scope;
    return this.db.write(async (scope) => {
      const { tx } = scope;
      const order = await tx.loadingOrder.findUnique({ where: { id: input.orderId }, select: { id: true, tenantId: true, status: true } });
      if (!order) throw AppError.notFound('Ordem não encontrada.');
      if (order.status === 'DRAFT') throw AppError.domain(ErrorCode.INVALID_TRANSITION, 'Ocorrências só podem ser abertas em ordens publicadas.');
      if (input.loadId) {
        const load = await tx.load.findUnique({ where: { id: input.loadId }, select: { orderId: true } });
        if (!load || load.orderId !== order.id) {
          throw AppError.domain(ErrorCode.INCONSISTENT_RELATION, 'A carga não pertence a esta ordem.', { fields: { loadId: ['Carga de outra ordem'] } });
        }
      }
      const row = await openOccurrence(scope, {
        tenantId: order.tenantId,
        orderId: order.id,
        loadId: input.loadId ?? null,
        type: input.type,
        severity: input.severity,
        title: input.title,
        description: input.description ?? null,
        visibility: visibilityFor(scopeName, input.visibility),
        responsibleUserId: scopeName === 'FARM' ? null : await this.responsible(tx, input.responsibleUserId),
        dueOn: toDate(input.dueOn),
        source: 'MANUAL',
        createdBy: auth.userId,
      });
      return this.dto(tx, row.id);
    });
  }

  update(id: string, input: UpdateInput): Promise<OccurrenceDto> {
    const scopeName = currentAuth().membership!.scope;
    return this.db.write(async ({ tx, audit }) => {
      const row = await this.lock(tx, id, input.expectedUpdatedAt);
      if (CLOSED.includes(row.status)) throw AppError.domain(ErrorCode.INVALID_TRANSITION, 'Reabra a ocorrência para editá-la.');
      const data = {
        type: input.type,
        severity: input.severity,
        title: input.title,
        description: input.description ?? null,
        visibility: visibilityFor(scopeName, input.visibility),
        dueOn: toDate(input.dueOn),
        responsibleUserId: scopeName === 'FARM' ? row.responsibleUserId : await this.responsible(tx, input.responsibleUserId),
      };
      await tx.occurrence.update({ where: { id }, data });
      await audit({ entityType: 'occurrence', entityId: id, action: 'occurrence.updated', before: snapshot(row), after: snapshot({ ...row, ...data }) });
      return this.dto(tx, id);
    });
  }

  transition(id: string, input: TransitionInput): Promise<OccurrenceDto> {
    const auth = currentAuth();
    const scopeName = auth.membership!.scope;
    return this.db.write(async ({ tx, audit, outbox }) => {
      const row = await this.lock(tx, id, input.expectedUpdatedAt);
      const to = input.to;
      if (!canTransitionOccurrence(row.status, to, scopeName)) {
        throw AppError.domain(
          ErrorCode.INVALID_TRANSITION,
          `Não é possível passar de "${OCCURRENCE_STATUS_LABELS[row.status]}" para "${OCCURRENCE_STATUS_LABELS[to]}" com seu perfil.`,
        );
      }
      const closing = CLOSED.includes(to);
      if (closing && !input.resolution) {
        const message = to === 'RESOLVED' ? 'Descreva a solução.' : 'Informe o motivo do cancelamento.';
        throw AppError.validation({ fields: { resolution: [message] } }, message);
      }
      const data: Prisma.OccurrenceUncheckedUpdateInput = closing
        ? { status: to, resolution: input.resolution, resolvedAt: new Date(), resolvedBy: auth.userId }
        : to === 'OPEN'
          ? { status: to, resolution: null, resolvedAt: null, resolvedBy: null }
          : { status: to };
      await tx.occurrence.update({ where: { id }, data });
      await audit({ entityType: 'occurrence', entityId: id, action: 'occurrence.status_changed', before: { status: row.status }, after: { status: to, resolution: input.resolution ?? null } });
      await audit({
        entityType: 'loading_order',
        entityId: row.orderId,
        action: to === 'RESOLVED' ? 'order.occurrence_resolved' : 'order.occurrence_status',
        after: { occurrenceNumber: row.number, title: row.title, statusLabel: OCCURRENCE_STATUS_LABELS[to], visibility: row.visibility },
      });
      await outbox({ type: 'occurrence.status_changed', aggregateType: 'occurrence', aggregateId: id, payload: { occurrenceId: id, orderId: row.orderId, from: row.status, to } });
      return this.dto(tx, id);
    });
  }

  // ───────────────────────────── Internos ─────────────────────────────

  /** Responsável deve ser usuário ativo da Matriz do tenant. */
  private async responsible(tx: Tx, userId?: string | null): Promise<string | null> {
    if (!userId) return null;
    const membership = await tx.membership.findFirst({ where: { userId, status: 'ACTIVE', scope: 'MATRIZ' }, select: { userId: true } });
    if (!membership) throw AppError.validation({ fields: { responsibleUserId: ['Selecione um usuário da Matriz'] } });
    return userId;
  }

  private async lock(tx: Tx, id: string, expectedUpdatedAt: string): Promise<OccurrenceRow> {
    const locked = await tx.$queryRaw<{ id: string }[]>`select id from occurrences where id = ${id}::uuid for update`;
    if (!locked.length) throw AppError.notFound('Ocorrência não encontrada.');
    const row = await tx.occurrence.findUniqueOrThrow({ where: { id } });
    if (new Date(expectedUpdatedAt).getTime() !== row.updatedAt.getTime()) {
      throw AppError.conflict('Esta ocorrência foi atualizada por outra pessoa. Recarregue para continuar.', ErrorCode.ORDER_STALE);
    }
    return row;
  }

  private async dto(tx: Tx, id: string): Promise<OccurrenceDto> {
    const row = await tx.occurrence.findUnique({ where: { id } });
    if (!row) throw AppError.notFound('Ocorrência não encontrada.');
    return (await this.toDtos(tx, [row]))[0]!;
  }

  private async toDtos(tx: Tx, rows: OccurrenceRow[]): Promise<OccurrenceDto[]> {
    if (!rows.length) return [];
    const auth = currentAuth();
    const scopeName = auth.membership!.scope;
    const canManage = auth.permissions.has('occurrence.manage');
    const [orders, loads, users] = await Promise.all([
      tx.loadingOrder.findMany({ where: { id: { in: uniq(rows.map((r) => r.orderId)) } }, select: { id: true, number: true } }),
      tx.load.findMany({ where: { id: { in: uniq(rows.map((r) => r.loadId)) } }, select: { id: true, number: true } }),
      tx.user.findMany({ where: { id: { in: uniq(rows.flatMap((r) => [r.responsibleUserId, r.createdBy])) } }, select: { id: true, name: true } }),
    ]);
    const orderNumbers = new Map(orders.map((o) => [o.id, o.number]));
    const loadNumbers = new Map(loads.map((l) => [l.id, l.number]));
    const names = new Map(users.map((u) => [u.id, u.name]));
    const today = new Date().toISOString().slice(0, 10);

    return rows.map((r) => {
      const dueOn = fromDate(r.dueOn);
      return {
        id: r.id,
        number: r.number,
        order: { id: r.orderId, number: orderNumbers.get(r.orderId) ?? '' },
        load: r.loadId ? { id: r.loadId, number: loadNumbers.get(r.loadId) ?? '' } : null,
        type: r.type,
        severity: r.severity,
        status: r.status,
        title: r.title,
        description: r.description,
        visibility: r.visibility,
        responsible: r.responsibleUserId ? { id: r.responsibleUserId, name: names.get(r.responsibleUserId) ?? '—' } : null,
        dueOn,
        overdue: Boolean(dueOn && dueOn < today && !CLOSED.includes(r.status)),
        resolution: r.resolution,
        resolvedAt: r.resolvedAt?.toISOString() ?? null,
        source: r.source === 'SYSTEM' ? 'SYSTEM' : 'MANUAL',
        createdBy: r.createdBy ? (names.get(r.createdBy) ?? null) : null,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
        allowedTransitions: canManage ? OCCURRENCE_TRANSITIONS[r.status].filter((to) => canTransitionOccurrence(r.status, to, scopeName)) : [],
      };
    });
  }
}
