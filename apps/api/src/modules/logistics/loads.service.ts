import { Injectable } from '@nestjs/common';
import {
  canTransitionLoad,
  ErrorCode,
  LOAD_STATUS_LABELS,
  LOAD_TRANSITIONS,
  type LoadDto,
  type LoadFiscalChecklist,
  type LoadHistoryItem,
  type LoadStatus,
  type LoadTransitionInput,
  type LoadUpdateInput,
  type LogisticsListQuery,
  type Page,
} from '@ordens/contracts';
import { Prisma, type Tx } from '@ordens/db';
import { AppError } from '../../common/errors.js';
import { currentAuth } from '../../common/request-context.js';
import { TenantDb } from '../../infra/tenant-db.service.js';
import { fromDate, toDate } from '../registry/registry.util.js';
import { autoCompleteIfFinished } from '../orders/order-completion.util.js';
import { fiscalChecklists, matrizChecklists } from './fiscal-checklist.js';
import { orderForLogistics, readVehicles, recalcOrder, resolveTransport, transportDto } from './logistics.util.js';

type LoadRow = NonNullable<Awaited<ReturnType<Tx['load']['findUnique']>>>;

const D = Prisma.Decimal;
/** Transporte ainda pode ser trocado: antes da confirmação do carregamento (pesagem). */
const PRE_LOADED: LoadStatus[] = ['SCHEDULED', 'CONFIRMED', 'AWAITING_LOADING', 'LOADING'];
const TRANSPORT_REQUIRED_FROM: LoadStatus[] = ['LOADING', 'LOADED', 'AWAITING_FARM_INVOICE', 'FARM_INVOICED'];
/** Campos de transporte digitados: mudá-los depois do carregamento é bloqueado. */
const TRANSPORT_FIELDS = [
  'carrierName',
  'driverName',
  'driverCpf',
  'driverRg',
  'driverPhone',
  'driverBirthDate',
  'driverCnh',
  'driverCnhCategory',
  'driverCnhExpiresAt',
  'driverCnhRestrictions',
  'vehicles',
] as const;

/** Trânsito encerrado sem recebimento (ordem dispensa a etapa). */
@Injectable()
export class LoadsService {
  constructor(private readonly db: TenantDb) {}

  list(q: LogisticsListQuery): Promise<Page<LoadDto>> {
    return this.db.read(async (tx) => {
      const plate = q.q?.toUpperCase().replace(/[^A-Z0-9]/g, '') ?? '';
      const where: Prisma.LoadWhereInput = {
        ...(q.orderId ? { orderId: q.orderId } : {}),
        ...(q.status?.length ? { status: { in: q.status as LoadStatus[] } } : {}),
        ...(q.carrier ? { carrierName: q.carrier } : {}),
        ...(q.from || q.to ? { loadingDate: { ...(q.from ? { gte: toDate(q.from)! } : {}), ...(q.to ? { lte: toDate(q.to)! } : {}) } } : {}),
        ...(q.q
          ? {
              OR: [
                { number: { contains: q.q } },
                ...(plate.length >= 3 ? [{ plates: { has: plate } }] : []),
                { driverName: { contains: q.q, mode: 'insensitive' as const } },
                { carrierName: { contains: q.q, mode: 'insensitive' as const } },
              ],
            }
          : {}),
      };
      const [total, rows] = await Promise.all([
        tx.load.count({ where }),
        tx.load.findMany({ where, orderBy: [{ updatedAt: 'desc' }], skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      ]);
      return { total, page: q.page, pageSize: q.pageSize, items: await this.toDtos(tx, rows) };
    });
  }

  detail(id: string): Promise<LoadDto & { history: LoadHistoryItem[] }> {
    return this.db.read(async (tx) => {
      const dto = await this.dto(tx, id);
      const history = await tx.loadStatusHistory.findMany({ where: { loadId: id }, orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }] });
      const users = await tx.user.findMany({ where: { id: { in: history.map((h) => h.actorUserId).filter((v): v is string => Boolean(v)) } }, select: { id: true, name: true } });
      const names = new Map(users.map((u) => [u.id, u.name]));
      return {
        ...dto,
        history: history.map((h) => ({
          id: h.id.toString(),
          from: h.fromStatus,
          to: h.toStatus,
          actor: h.actorUserId ? (names.get(h.actorUserId) ?? null) : null,
          notes: h.notes,
          occurredAt: h.occurredAt.toISOString(),
        })),
      };
    });
  }

  /**
   * A Fazenda informa que o caminhão chegou: é isso que cria a carga, já aguardando carregamento.
   * Não há liberação nem agendamento antes — a ordem publicada é a autorização. Transportadora,
   * motorista e veículos vêm do que foi informado na ordem e podem ser corrigidos na carga enquanto
   * ela não for pesada.
   */
  registerArrival(orderId: string): Promise<LoadDto> {
    return this.db.write(async ({ tx, audit, outbox }) => {
      // Quem opera a carga é a Fazenda (ou a Matriz por ela); o Comprador só acompanha.
      if (currentAuth().membership!.scope === 'BUYER') throw AppError.forbidden('Somente a Fazenda ou a Matriz informam a chegada do caminhão.');
      const order = await orderForLogistics(tx, orderId);
      const source = await tx.loadingOrder.findUniqueOrThrow({ where: { id: orderId } });
      if (!source.farmId) throw AppError.domain(ErrorCode.INVALID_TRANSITION, 'A ordem ainda não tem fazenda definida.');
      const transport = resolveTransport(transportDto(source));

      const agg = await tx.load.aggregate({ where: { orderId: order.id }, _max: { sequence: true } });
      const sequence = (agg._max.sequence ?? 0) + 1;
      const number = `${order.number}-C${String(sequence).padStart(2, '0')}`;
      const now = new Date();
      const load = await tx.load.create({
        data: {
          tenantId: order.tenantId,
          orderId: order.id,
          number,
          sequence,
          loadingDate: toDate(now.toISOString().slice(0, 10)),
          // Sem previsão por caminhão: a quantidade da carga é o peso líquido da pesagem.
          expectedQty: 0,
          status: 'AWAITING_LOADING',
          createdBy: currentAuth().userId,
          ...transport,
        },
      });
      await tx.loadStatusHistory.create({
        data: { tenantId: order.tenantId, loadId: load.id, fromStatus: null, toStatus: 'AWAITING_LOADING', actorUserId: currentAuth().userId, notes: 'Caminhão na fazenda' },
      });
      await recalcOrder(tx, order.id);

      await audit({ entityType: 'load', entityId: load.id, action: 'load.created', after: { number, status: 'AWAITING_LOADING', plates: transport.plates } });
      await audit({ entityType: 'loading_order', entityId: order.id, action: 'order.truck_arrived', after: { loadNumber: number, plates: transport.plates } });
      await outbox({ type: 'load.created', aggregateType: 'load', aggregateId: load.id, payload: { loadId: load.id, orderId: order.id, number } });
      return this.dto(tx, load.id);
    });
  }

  update(id: string, input: LoadUpdateInput & { expectedUpdatedAt: string }): Promise<LoadDto> {
    return this.db.write(async ({ tx, audit }) => {
      const load = await this.lock(tx, id, input.expectedUpdatedAt);
      if (load.status === 'COMPLETED' || load.status === 'CANCELLED') throw AppError.domain(ErrorCode.INVALID_TRANSITION, 'Cargas concluídas ou canceladas não podem ser alteradas.');

      const current = transportDto(load);
      const sent = input as Record<string, unknown>;
      const transportChanged = TRANSPORT_FIELDS.some((k) => sent[k] !== undefined && JSON.stringify(sent[k] ?? null) !== JSON.stringify(current[k] ?? null));
      if (transportChanged && !PRE_LOADED.includes(load.status)) {
        throw AppError.domain(ErrorCode.INVALID_TRANSITION, 'Motorista e veículos não podem ser trocados após o carregamento.');
      }
      // O que não veio na requisição fica como está (edição parcial da carga).
      const transport = transportChanged
        ? resolveTransport(Object.fromEntries(TRANSPORT_FIELDS.map((k) => [k, sent[k] !== undefined ? sent[k] : current[k]])))
        : {};

      const weights = this.weights(input.grossKg ?? load.grossKg?.toString() ?? null, input.tareKg ?? load.tareKg?.toString() ?? null);
      await tx.load.update({
        where: { id },
        data: {
          ...transport,
          ...(input.loadingDate !== undefined ? { loadingDate: toDate(input.loadingDate as string | null) } : {}),
          ...weights,
          ...(input.invoicedQty !== undefined ? { invoicedQty: input.invoicedQty } : {}),
          ...(input.notes !== undefined ? { notes: input.notes } : {}),
        },
      });
      await recalcOrder(tx, load.orderId);
      await audit({
        entityType: 'load',
        entityId: id,
        action: 'load.updated',
        before: { plates: load.plates, grossKg: load.grossKg?.toString() ?? null, tareKg: load.tareKg?.toString() ?? null },
        after: { plates: 'plates' in transport ? transport.plates : load.plates, ...weights },
      });
      return this.dto(tx, id);
    });
  }

  transition(id: string, input: LoadTransitionInput & { expectedUpdatedAt: string }): Promise<LoadDto> {
    const auth = currentAuth();
    const scopeName = auth.membership!.scope;
    return this.db.write(async (scope) => {
      const { tx, audit, outbox } = scope;
      const load = await this.lock(tx, id, input.expectedUpdatedAt);
      const to = input.to as LoadStatus;
      if (!canTransitionLoad(load.status, to, scopeName)) {
        throw AppError.domain(ErrorCode.INVALID_TRANSITION, `Não é possível passar de "${LOAD_STATUS_LABELS[load.status]}" para "${LOAD_STATUS_LABELS[to]}" com seu perfil.`);
      }
      if (to === 'CANCELLED' && !input.notes) throw AppError.validation({ fields: { notes: ['Informe o motivo do cancelamento'] } }, 'Informe o motivo do cancelamento.');
      if (TRANSPORT_REQUIRED_FROM.includes(to)) {
        const vehicles = readVehicles(load.vehicles);
        if (!load.driverName || !vehicles.length) {
          throw AppError.domain(ErrorCode.VALIDATION_FAILED, 'Informe o motorista e ao menos um veículo antes de iniciar o carregamento.', {
            fields: { driverName: load.driverName ? [] : ['Obrigatório'], vehicles: vehicles.length ? [] : ['Informe ao menos um veículo'] },
          });
        }
      }

      // Q41: documentação fiscal validada (e o trânsito) exigem pesagem, PDF e XML válidos da mesma carga.
      let checklist: LoadFiscalChecklist | null = null;
      if (to === 'FARM_INVOICED' || to === 'IN_TRANSIT') {
        checklist = (await fiscalChecklists(tx, [load], true)).get(id)!;
        if (!checklist.ready) {
          throw AppError.domain(ErrorCode.FISCAL_DOCUMENTS_REQUIRED, `Documentação fiscal incompleta. ${checklist.issues.join(' ')}`, { checklist });
        }
      }

      // Q47: faturamento da Matriz exige PDF e XML da nota emitida para o Comprador.
      let matrizChecklist: LoadFiscalChecklist | null = null;
      if (to === 'MATRIZ_INVOICED' || to === 'COMPLETED') {
        matrizChecklist = (await matrizChecklists(tx, [load], true)).get(id)!;
        // Q47: documentos da Matriz são o padrão; sem eles, só com confirmação explícita (auditada abaixo).
        if (!matrizChecklist.ready && !input.acceptMissingMatrizInvoice) {
          throw AppError.domain(
            ErrorCode.MATRIZ_INVOICE_MISSING,
            `Nota da Matriz pendente. ${matrizChecklist.issues.join(' ')} Confirme para seguir sem os documentos.`,
            { checklist: matrizChecklist },
          );
        }
      }

      const gross = input.grossKg ?? load.grossKg?.toString() ?? null;
      const tare = input.tareKg ?? load.tareKg?.toString() ?? null;
      const weights = this.weights(gross, tare);
      const data: Prisma.LoadUncheckedUpdateInput = { ...weights };

      if (to === 'LOADED') {
        if (!gross || !tare) {
          throw AppError.domain(ErrorCode.VALIDATION_FAILED, 'Informe peso bruto e tara para confirmar o carregamento.', {
            fields: { grossKg: gross ? [] : ['Obrigatório'], tareKg: tare ? [] : ['Obrigatório'] },
          });
        }
        // Não há teto: a Fazenda carrega o que chegou e a ordem mostra quando passou da quantidade.
        data.loadedAt = new Date();
      }
      // Do trânsito a carga vai direto ao faturamento: faturar na Matriz é o próprio fim do transporte.
      if (to === 'MATRIZ_INVOICED' && !load.receivedAt) data.receivedAt = new Date();

      // Carregamento confirmado segue direto para "Aguardando documentação fiscal da Fazenda".
      const steps: LoadStatus[] = to === 'LOADED' ? ['LOADED', 'AWAITING_FARM_INVOICE'] : [to];
      const finalStatus = steps[steps.length - 1]!;
      data.status = finalStatus;
      await tx.load.update({ where: { id }, data });

      let from = load.status;
      for (const step of steps) {
        const notes = step === 'AWAITING_FARM_INVOICE' && to === 'LOADED' ? 'Aguardando PDF da nota e XML da NF-e da Fazenda' : (input.notes ?? null);
        await tx.loadStatusHistory.create({ data: { tenantId: load.tenantId, loadId: id, fromStatus: from, toStatus: step, actorUserId: auth.userId, notes } });
        await audit({ entityType: 'load', entityId: id, action: 'load.status_changed', before: { status: from }, after: { status: step, notes, ...(step === 'LOADED' ? weights : {}) } });
        await audit({ entityType: 'loading_order', entityId: load.orderId, action: 'order.load_status', after: { loadNumber: load.number, statusLabel: LOAD_STATUS_LABELS[step], plates: load.plates } });
        from = step;
      }
      if (matrizChecklist && !matrizChecklist.ready) {
        await audit({
          entityType: 'load',
          entityId: id,
          action: 'load.matriz_invoice_waived',
          after: { to, pdf: matrizChecklist.pdf, xml: matrizChecklist.xml, reason: 'Confirmado sem a nota da Matriz' },
        });
      }
      if (to === 'MATRIZ_INVOICED' && matrizChecklist?.ready) {
        await audit({ entityType: 'load', entityId: id, action: 'load.matriz_invoice_validated', after: { pdf: matrizChecklist.pdf, xml: matrizChecklist.xml } });
        await audit({
          entityType: 'loading_order',
          entityId: load.orderId,
          action: 'order.load_matriz_invoiced',
          after: { loadNumber: load.number, statusLabel: LOAD_STATUS_LABELS.MATRIZ_INVOICED },
        });
      }
      if (to === 'FARM_INVOICED' && checklist) {
        await audit({ entityType: 'load', entityId: id, action: 'load.documents_validated', after: { pdf: checklist.pdf, xml: checklist.xml } });
        await audit({ entityType: 'loading_order', entityId: load.orderId, action: 'order.load_documents_validated', after: { loadNumber: load.number, statusLabel: LOAD_STATUS_LABELS.FARM_INVOICED } });
      }

      const order = await tx.loadingOrder.findUniqueOrThrow({ where: { id: load.orderId } });
      if (order.status === 'PUBLISHED' && !['SCHEDULED', 'CONFIRMED', 'AWAITING_LOADING', 'CANCELLED'].includes(finalStatus)) {
        await tx.loadingOrder.update({ where: { id: order.id }, data: { status: 'IN_PROGRESS' } });
        await audit({ entityType: 'loading_order', entityId: order.id, action: 'order.status_changed', before: { status: 'PUBLISHED' }, after: { status: 'IN_PROGRESS', reason: `Carga ${load.number} iniciou o carregamento` } });
      }
      await recalcOrder(tx, load.orderId);

      // Q45: encerrada a última carga, a ordem conclui sozinha quando nada mais está pendente.
      if (finalStatus === 'COMPLETED' || finalStatus === 'CANCELLED') await autoCompleteIfFinished(scope, load.orderId);

      await outbox({ type: 'load.status_changed', aggregateType: 'load', aggregateId: id, payload: { loadId: id, orderId: load.orderId, number: load.number, from: load.status, to: finalStatus } });
      return this.dto(tx, id);
    });
  }

  // ───────────────────────────── Internos ─────────────────────────────

  private weights(gross: string | null, tare: string | null) {
    if (gross && tare && new D(gross).lessThan(tare)) {
      throw AppError.validation({ fields: { tareKg: ['A tara não pode ser maior que o peso bruto'] } }, 'A tara não pode ser maior que o peso bruto.');
    }
    return {
      ...(gross !== null ? { grossKg: gross } : {}),
      ...(tare !== null ? { tareKg: tare } : {}),
      ...(gross && tare ? { netKg: new D(gross).minus(tare).toString() } : {}),
    } as { grossKg?: string; tareKg?: string; netKg?: string };
  }

  private async lock(tx: Tx, id: string, expectedUpdatedAt: string): Promise<LoadRow> {
    const locked = await tx.$queryRaw<{ id: string }[]>`select id from loads where id = ${id}::uuid for update`;
    if (!locked.length) throw AppError.notFound('Carga não encontrada.');
    const load = await tx.load.findUniqueOrThrow({ where: { id } });
    if (new Date(expectedUpdatedAt).getTime() !== load.updatedAt.getTime()) {
      throw AppError.conflict('Esta carga foi atualizada por outra pessoa. Recarregue para continuar.', ErrorCode.ORDER_STALE);
    }
    return load;
  }

  private async dto(tx: Tx, id: string): Promise<LoadDto> {
    const row = await tx.load.findUnique({ where: { id } });
    if (!row) throw AppError.notFound('Carga não encontrada.');
    return (await this.toDtos(tx, [row]))[0]!;
  }

  private async toDtos(tx: Tx, rows: LoadRow[]): Promise<LoadDto[]> {
    if (!rows.length) return [];
    const checklists = await fiscalChecklists(tx, rows);
    const matriz = await matrizChecklists(tx, rows);
    const orderIds = [...new Set(rows.map((r) => r.orderId))];
    const orders = await tx.$queryRaw<{ id: string; number: string; commodity: string | null; farm: string | null; buyer: string | null; unit: string | null; factor: Prisma.Decimal | null }[]>(Prisma.sql`
      select lo.id, lo.number, c.name as commodity, f.name as farm, coalesce(bp.trade_name, bp.legal_name) as buyer, u.code as unit, u.factor_to_kg as factor
      from loading_orders lo
      left join commodities c on c.id = lo.commodity_id
      left join farms f on f.id = lo.farm_id
      left join business_partners bp on bp.id = lo.buyer_partner_id
      left join units u on u.id = lo.unit_id
      where lo.id in (${Prisma.join(orderIds.map((o) => Prisma.sql`${o}::uuid`))})
    `);
    const orderMap = new Map(orders.map((o) => [o.id, o]));
    const auth = currentAuth();
    const scopeName = auth.membership!.scope;
    const canManage = auth.permissions.has('load.manage');

    return rows.map((r) => {
      const o = orderMap.get(r.orderId);
      return {
        id: r.id,
        number: r.number,
        order: { id: r.orderId, number: o?.number ?? '', commodity: o?.commodity ?? null, farm: o?.farm ?? null, buyer: o?.buyer ?? null, unit: o?.unit === 'T' ? 't' : (o?.unit?.toLowerCase() ?? '') },
        loadingDate: fromDate(r.loadingDate),
        expectedQty: r.expectedQty.toString(),
        grossKg: r.grossKg?.toString() ?? null,
        tareKg: r.tareKg?.toString() ?? null,
        netKg: r.netKg?.toString() ?? null,
        invoicedQty: r.invoicedQty?.toString() ?? null,
        status: r.status,
        notes: r.notes,
        updatedAt: r.updatedAt.toISOString(),
        allowedTransitions: canManage ? LOAD_TRANSITIONS[r.status].filter((to) => canTransitionLoad(r.status, to, scopeName)) : [],
        fiscalChecklist: checklists.get(r.id) ?? null,
        matrizChecklist: matriz.get(r.id) ?? null,
        ...transportDto(r),
      };
    });
  }
}
