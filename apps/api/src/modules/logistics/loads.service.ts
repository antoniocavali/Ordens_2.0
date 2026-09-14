import { Injectable } from '@nestjs/common';
import {
  canTransitionLoad,
  ErrorCode,
  LOAD_STATUS_LABELS,
  LOAD_TRANSITIONS,
  loadInputSchema,
  type LoadDto,
  type LoadHistoryItem,
  type LoadStatus,
  type LoadTransitionInput,
  type LoadUpdateInput,
  type LogisticsListQuery,
  type Page,
} from '@ordens/contracts';
import { Prisma, type Tx, type UnitOfWorkScope } from '@ordens/db';
import type { z } from 'zod';
import { AppError } from '../../common/errors.js';
import { currentAuth } from '../../common/request-context.js';
import { TenantDb } from '../../infra/tenant-db.service.js';
import { fromDate, toDate } from '../registry/registry.util.js';
import { openOccurrence } from '../fiscal/fiscal.util.js';
import { assertWithinReleased, fleetRefs, orderForLogistics, recalcOrder, resolveFleet } from './logistics.util.js';

type LoadData = z.output<typeof loadInputSchema>;
type LoadRow = NonNullable<Awaited<ReturnType<Tx['load']['findUnique']>>>;

const D = Prisma.Decimal;
const PRE_LOADED: LoadStatus[] = ['SCHEDULED', 'CONFIRMED', 'AWAITING_LOADING', 'LOADING', 'AWAITING_FARM_INVOICE', 'FARM_INVOICED'];
const FLEET_REQUIRED_FROM: LoadStatus[] = ['LOADING', 'AWAITING_FARM_INVOICE', 'FARM_INVOICED', 'LOADED'];

@Injectable()
export class LoadsService {
  constructor(private readonly db: TenantDb) {}

  list(q: LogisticsListQuery): Promise<Page<LoadDto>> {
    return this.db.read(async (tx) => {
      const plate = q.q?.toUpperCase().replace(/[^A-Z0-9]/g, '') ?? '';
      const where: Prisma.LoadWhereInput = {
        ...(q.orderId ? { orderId: q.orderId } : {}),
        ...(q.status?.length ? { status: { in: q.status as LoadStatus[] } } : {}),
        ...(q.carrierPartnerId ? { carrierPartnerId: q.carrierPartnerId } : {}),
        ...(q.from || q.to ? { loadingDate: { ...(q.from ? { gte: toDate(q.from)! } : {}), ...(q.to ? { lte: toDate(q.to)! } : {}) } } : {}),
        ...(q.q ? { OR: [{ number: { contains: q.q } }, ...(plate.length >= 3 ? [{ plates: { has: plate } }] : [])] } : {}),
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
      const history = await tx.loadStatusHistory.findMany({ where: { loadId: id }, orderBy: { occurredAt: 'asc' } });
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

  create(input: LoadData): Promise<LoadDto> {
    return this.db.write(async (scope) => {
      const id = await this.createInScope(scope, input);
      return this.dto(scope.tx, id);
    });
  }

  /** Cria a carga dentro de uma unidade de trabalho existente (reutilizado na conversão de agendamento). */
  async createInScope(scope: UnitOfWorkScope, input: LoadData): Promise<string> {
    const { tx, audit, outbox } = scope;
    const order = await orderForLogistics(tx, input.orderId);
    const fresh = await recalcOrder(tx, order.id);

    let freed = new D(0);
    if (input.appointmentId) {
      const appt = await tx.appointment.findUnique({ where: { id: input.appointmentId }, include: { load: true } });
      if (!appt || appt.orderId !== order.id) throw AppError.domain(ErrorCode.INCONSISTENT_RELATION, 'Agendamento não pertence a esta ordem.');
      if (appt.load) throw AppError.conflict('Este agendamento já gerou uma carga.');
      if (!['REQUESTED', 'CONFIRMED', 'CHECKED_IN'].includes(appt.status)) throw AppError.domain(ErrorCode.INVALID_TRANSITION, 'Agendamento cancelado não gera carga.');
      freed = appt.expectedQty;
    }
    assertWithinReleased(fresh, input.expectedQty, freed);
    const fleet = await resolveFleet(tx, input);

    const agg = await tx.load.aggregate({ where: { orderId: order.id }, _max: { sequence: true } });
    const sequence = (agg._max.sequence ?? 0) + 1;
    const number = `${order.number}-C${String(sequence).padStart(2, '0')}`;
    const load = await tx.load.create({
      data: {
        tenantId: order.tenantId,
        orderId: order.id,
        appointmentId: input.appointmentId ?? null,
        number,
        sequence,
        loadingDate: toDate(input.loadingDate),
        expectedQty: input.expectedQty,
        notes: input.notes ?? null,
        createdBy: currentAuth().userId,
        ...fleet,
      },
    });
    await tx.loadStatusHistory.create({ data: { tenantId: order.tenantId, loadId: load.id, fromStatus: null, toStatus: 'SCHEDULED', actorUserId: currentAuth().userId } });
    if (input.appointmentId) await tx.appointment.update({ where: { id: input.appointmentId }, data: { status: 'CONVERTED' } });
    await recalcOrder(tx, order.id);

    await audit({ entityType: 'load', entityId: load.id, action: 'load.created', after: { number, ...input, plates: fleet.plates } });
    await audit({ entityType: 'loading_order', entityId: order.id, action: 'order.load_created', after: { loadNumber: number, quantity: input.expectedQty, plates: fleet.plates } });
    await outbox({ type: 'load.created', aggregateType: 'load', aggregateId: load.id, payload: { loadId: load.id, orderId: order.id, number } });
    return load.id;
  }

  update(id: string, input: LoadUpdateInput & { expectedUpdatedAt: string }): Promise<LoadDto> {
    return this.db.write(async ({ tx, audit }) => {
      const load = await this.lock(tx, id, input.expectedUpdatedAt);
      if (load.status === 'COMPLETED' || load.status === 'CANCELLED') throw AppError.domain(ErrorCode.INVALID_TRANSITION, 'Cargas concluídas ou canceladas não podem ser alteradas.');

      const fleetChanged = ['carrierPartnerId', 'driverId', 'tractorVehicleId', 'trailerVehicleId', 'secondTrailerVehicleId'].some(
        (k) => (input as Record<string, unknown>)[k] !== undefined && (input as Record<string, unknown>)[k] !== (load as Record<string, unknown>)[k],
      );
      if (fleetChanged && !PRE_LOADED.includes(load.status)) {
        throw AppError.domain(ErrorCode.INVALID_TRANSITION, 'Motorista e veículos não podem ser trocados após o carregamento.');
      }
      const fleet = fleetChanged
        ? await resolveFleet(tx, {
            carrierPartnerId: input.carrierPartnerId !== undefined ? input.carrierPartnerId : load.carrierPartnerId,
            driverId: input.driverId !== undefined ? input.driverId : load.driverId,
            tractorVehicleId: input.tractorVehicleId !== undefined ? input.tractorVehicleId : load.tractorVehicleId,
            trailerVehicleId: input.trailerVehicleId !== undefined ? input.trailerVehicleId : load.trailerVehicleId,
            secondTrailerVehicleId: input.secondTrailerVehicleId !== undefined ? input.secondTrailerVehicleId : load.secondTrailerVehicleId,
          })
        : {};

      const weights = this.weights(input.grossKg ?? load.grossKg?.toString() ?? null, input.tareKg ?? load.tareKg?.toString() ?? null);
      await tx.load.update({
        where: { id },
        data: {
          ...fleet,
          ...(input.loadingDate !== undefined ? { loadingDate: toDate(input.loadingDate as string | null) } : {}),
          ...weights,
          ...(input.invoicedQty !== undefined ? { invoicedQty: input.invoicedQty } : {}),
          ...(input.receivedQty !== undefined ? { receivedQty: input.receivedQty } : {}),
          ...(input.notes !== undefined ? { notes: input.notes } : {}),
        },
      });
      await recalcOrder(tx, load.orderId);
      await audit({
        entityType: 'load',
        entityId: id,
        action: 'load.updated',
        before: { plates: load.plates, grossKg: load.grossKg?.toString() ?? null, tareKg: load.tareKg?.toString() ?? null, receivedQty: load.receivedQty?.toString() ?? null },
        after: { plates: 'plates' in fleet ? fleet.plates : load.plates, ...weights, receivedQty: input.receivedQty ?? null },
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
      if (to === 'FARM_INVOICED') {
        // Q13: exige NF-e da Fazenda registrada (válida ou com divergência).
        const invoices = await tx.invoice.count({ where: { loadId: id, origin: 'FARM', status: { in: ['VALID', 'DIVERGENT'] } } });
        if (!invoices) {
          throw AppError.domain(ErrorCode.INVOICE_REQUIRED, 'Anexe o XML da NF-e da Fazenda antes de marcar a carga como faturada.');
        }
      }
      if (!canTransitionLoad(load.status, to, scopeName)) {
        throw AppError.domain(ErrorCode.INVALID_TRANSITION, `Não é possível passar de "${LOAD_STATUS_LABELS[load.status]}" para "${LOAD_STATUS_LABELS[to]}" com seu perfil.`);
      }
      if (to === 'CANCELLED' && !input.notes) throw AppError.validation({ fields: { notes: ['Informe o motivo do cancelamento'] } }, 'Informe o motivo do cancelamento.');
      if (FLEET_REQUIRED_FROM.includes(to) && (!load.driverId || !load.tractorVehicleId)) {
        throw AppError.domain(ErrorCode.VALIDATION_FAILED, 'Informe motorista e veículo antes de iniciar o carregamento.', {
          fields: { driverId: load.driverId ? [] : ['Obrigatório'], tractorVehicleId: load.tractorVehicleId ? [] : ['Obrigatório'] },
        });
      }

      const weights = this.weights(input.grossKg ?? load.grossKg?.toString() ?? null, input.tareKg ?? load.tareKg?.toString() ?? null);
      const data: Prisma.LoadUncheckedUpdateInput = { status: to, ...weights };

      if (to === 'LOADED') {
        const net = weights.netKg ?? load.netKg;
        if (!net) {
          throw AppError.domain(ErrorCode.VALIDATION_FAILED, 'Informe peso bruto e tara para registrar o carregamento.', { fields: { grossKg: ['Obrigatório'], tareKg: ['Obrigatório'] } });
        }
        const order = await orderForLogistics(tx, load.orderId).catch(async () => recalcOrder(tx, load.orderId).then((o) => ({ ...o, unitFactorToKg: new D(1), unitCode: 'T' })));
        const fresh = await recalcOrder(tx, load.orderId);
        const factor = 'unitFactorToKg' in order ? order.unitFactorToKg : new D(1);
        const loadedInUnit = new D(net).dividedBy(factor);
        // Ao carregar, a quantidade prevista desta carga deixa de contar como agendada e passa a contar o peso real.
        assertWithinReleased(fresh, loadedInUnit, load.expectedQty);
      }
      if (to === 'RECEIVED') {
        const received = input.receivedQty ?? load.receivedQty?.toString();
        if (!received) throw AppError.domain(ErrorCode.VALIDATION_FAILED, 'Informe a quantidade recebida no destino.', { fields: { receivedQty: ['Obrigatório'] } });
        data.receivedQty = received;
      }

      await tx.load.update({ where: { id }, data });
      await tx.loadStatusHistory.create({ data: { tenantId: load.tenantId, loadId: id, fromStatus: load.status, toStatus: to, actorUserId: auth.userId, notes: input.notes ?? null } });
      if (to === 'CHECKED') await this.openWeightDivergence(scope, id, auth.userId);

      const order = await tx.loadingOrder.findUniqueOrThrow({ where: { id: load.orderId } });
      if (order.status === 'PUBLISHED' && !['SCHEDULED', 'CONFIRMED', 'AWAITING_LOADING', 'CANCELLED'].includes(to)) {
        await tx.loadingOrder.update({ where: { id: order.id }, data: { status: 'IN_PROGRESS' } });
        await audit({ entityType: 'loading_order', entityId: order.id, action: 'order.status_changed', before: { status: 'PUBLISHED' }, after: { status: 'IN_PROGRESS', reason: `Carga ${load.number} iniciou o carregamento` } });
      }
      await recalcOrder(tx, load.orderId);

      await audit({ entityType: 'load', entityId: id, action: 'load.status_changed', before: { status: load.status }, after: { status: to, notes: input.notes ?? null, ...weights } });
      await audit({ entityType: 'loading_order', entityId: load.orderId, action: 'order.load_status', after: { loadNumber: load.number, statusLabel: LOAD_STATUS_LABELS[to], plates: load.plates } });
      await outbox({ type: 'load.status_changed', aggregateType: 'load', aggregateId: id, payload: { loadId: id, orderId: load.orderId, number: load.number, from: load.status, to } });
      return this.dto(tx, id);
    });
  }

  // ───────────────────────────── Internos ─────────────────────────────

  /** Q17: recebido (em kg) fora da tolerância do peso líquido abre ocorrência automática visível à Fazenda. */
  private async openWeightDivergence(scope: UnitOfWorkScope, loadId: string, userId: string) {
    const { tx } = scope;
    const load = await tx.load.findUniqueOrThrow({ where: { id: loadId } });
    if (!load.netKg || !load.receivedQty) return;
    const order = await tx.loadingOrder.findUniqueOrThrow({ where: { id: load.orderId }, select: { tenantId: true, tolerancePct: true, unitId: true } });
    const unit = order.unitId ? await tx.unit.findUnique({ where: { id: order.unitId }, select: { factorToKg: true } }) : null;
    const receivedKg = new D(load.receivedQty).times(unit?.factorToKg ?? 1);
    const diff = receivedKg.minus(load.netKg);
    const limit = new D(load.netKg).times(D.max(order.tolerancePct, new D('0.5'))).dividedBy(100);
    if (diff.abs().lessThanOrEqualTo(limit)) return;
    const kg = (v: Prisma.Decimal) => v.toDecimalPlaces(0).toString();
    await openOccurrence(scope, {
      tenantId: order.tenantId,
      orderId: load.orderId,
      loadId,
      type: 'WEIGHT_DIVERGENCE',
      severity: 'MEDIUM',
      title: `Divergência de ${kg(diff)} kg na carga ${load.number}`,
      description: `Peso líquido carregado: ${kg(new D(load.netKg))} kg. Recebido: ${kg(receivedKg)} kg. Limite pela tolerância: ${kg(limit)} kg.`,
      visibility: 'FARM',
      responsibleUserId: null,
      dueOn: null,
      source: 'SYSTEM',
      createdBy: userId,
    });
  }

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
    const refs = await fleetRefs(tx, rows);
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
      const factor = o?.factor ? new D(o.factor) : new D(1);
      const netInUnit = r.netKg ? new D(r.netKg).dividedBy(factor) : null;
      const divergence = r.receivedQty && netInUnit ? new D(r.receivedQty).minus(netInUnit).times(factor) : null;
      return {
        id: r.id,
        number: r.number,
        order: { id: r.orderId, number: o?.number ?? '', commodity: o?.commodity ?? null, farm: o?.farm ?? null, buyer: o?.buyer ?? null, unit: o?.unit === 'T' ? 't' : (o?.unit?.toLowerCase() ?? '') },
        appointmentId: r.appointmentId,
        loadingDate: fromDate(r.loadingDate),
        expectedQty: r.expectedQty.toString(),
        grossKg: r.grossKg?.toString() ?? null,
        tareKg: r.tareKg?.toString() ?? null,
        netKg: r.netKg?.toString() ?? null,
        invoicedQty: r.invoicedQty?.toString() ?? null,
        receivedQty: r.receivedQty?.toString() ?? null,
        divergenceKg: divergence ? divergence.toDecimalPlaces(2).toString() : null,
        status: r.status,
        notes: r.notes,
        updatedAt: r.updatedAt.toISOString(),
        allowedTransitions: canManage ? LOAD_TRANSITIONS[r.status].filter((to) => canTransitionLoad(r.status, to, scopeName)) : [],
        ...refs(r),
      };
    });
  }
}
