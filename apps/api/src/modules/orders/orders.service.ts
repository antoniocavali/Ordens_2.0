import { Injectable } from '@nestjs/common';
import {
  compareDecimalStrings,
  ErrorCode,
  ORDER_MATERIAL_FIELDS,
  ORDER_PUBLISH_REQUIRED,
  type CancelReleaseInput,
  type CreateReleaseInput,
  type OrderDetail,
  type OrderDraftInput,
  type OrderListItem,
  type OrderListQuery,
  type OrdersSummary,
  type OrderVersionDto,
  type OrderViewHistoryItem,
  type Page,
  type ReleaseDto,
  type ReleaseListItem,
  type ReleaseListQuery,
  type ReleasesSummary,
  type TimelineEventDto,
  type UpdateOrderInput,
} from '@ordens/contracts';
import { nextSequence, Prisma, shallowDiff, type Tx, type UnitOfWorkScope } from '@ordens/db';
import { AppError } from '../../common/errors.js';
import { currentAuth, currentRequest } from '../../common/request-context.js';
import { TenantDb } from '../../infra/tenant-db.service.js';
import { dec, day, toDetail, toListItem } from './orders.mapper.js';
import { buildListFilters, orderCountSql, orderIdsSql, orderSelectSql, type OrderRow } from './orders.queries.js';
import { listReleases, releasesSummary } from './releases.queries.js';

type OrderRecord = NonNullable<Awaited<ReturnType<Tx['loadingOrder']['findUnique']>>>;

const DATE_FIELDS = new Set(['orderDate', 'loadingStartsOn', 'loadingEndsOn']);
const ACTIVE_STATUSES = ['PUBLISHED', 'IN_PROGRESS', 'SUSPENDED'];

const FIELD_LABELS: Record<string, string> = {
  sellerPartnerId: 'Vendedor',
  farmId: 'Fazenda',
  buyerPartnerId: 'Comprador',
  commodityId: 'Commodity',
  quantity: 'Quantidade',
  unitId: 'Unidade',
  loadingStartsOn: 'Início do carregamento',
  loadingEndsOn: 'Data limite',
};

const TIMELINE_LABELS: Record<string, string> = {
  'order.created': 'Ordem criada',
  'order.draft_saved': 'Rascunho atualizado',
  'order.published': 'Ordem publicada',
  'order.updated': 'Ordem atualizada',
  'order.version_created': 'Nova versão gerada',
  'order.release_created': 'Liberação criada',
  'order.release_cancelled': 'Liberação cancelada',
  'order.viewed': 'Ordem visualizada',
  'order.appointment_created': 'Agendamento realizado',
  'order.load_created': 'Carga criada',
  'order.load_status': 'Carga atualizada',
  'order.invoice_attached': 'NF-e anexada',
  'order.invoice_cancelled': 'NF-e cancelada',
  'order.occurrence_opened': 'Ocorrência aberta',
  'order.occurrence_status': 'Ocorrência atualizada',
  'order.occurrence_resolved': 'Ocorrência resolvida',
};

// Ocorrências ficam fora da timeline externa: a visibilidade é por ocorrência (ver aba Ocorrências).
const EXTERNAL_TIMELINE = new Set([
  'order.published',
  'order.version_created',
  'order.release_created',
  'order.release_cancelled',
  'order.appointment_created',
  'order.load_created',
  'order.load_status',
  'order.invoice_attached',
  'order.invoice_cancelled',
]);

/** Serializa valores para comparação/snapshot (decimais normalizados, datas AAAA-MM-DD). */
function normalize(field: string, value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (DATE_FIELDS.has(field) && value instanceof Date) return day(value);
  if (Prisma.Decimal.isDecimal(value)) return new Prisma.Decimal(value as Prisma.Decimal).toString();
  if (['quantity', 'unitPrice', 'tolerancePct', 'freightEstimate', 'initialReleaseQty'].includes(field) && typeof value === 'string') {
    return new Prisma.Decimal(value).toString();
  }
  return value;
}

/** Colunas NOT NULL com default: "limpar" no formulário significa voltar ao padrão. */
const NON_NULLABLE_DEFAULTS: Record<string, unknown> = { tolerancePct: '0', currency: 'BRL', priority: 'NORMAL' };

function toPrismaData(input: OrderDraftInput): Prisma.LoadingOrderUncheckedUpdateInput {
  const data: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(input)) {
    if (raw === undefined) continue;
    const value = raw === null && key in NON_NULLABLE_DEFAULTS ? NON_NULLABLE_DEFAULTS[key] : raw;
    data[key] = DATE_FIELDS.has(key) && typeof value === 'string' ? new Date(`${value}T00:00:00.000Z`) : value;
  }
  return data as Prisma.LoadingOrderUncheckedUpdateInput;
}

function snapshot(order: Record<string, unknown>) {
  return Object.fromEntries(ORDER_MATERIAL_FIELDS.map((f) => [f, normalize(f, order[f])]));
}

@Injectable()
export class OrdersService {
  constructor(private readonly db: TenantDb) {}

  // ───────────────────────────── Leitura ─────────────────────────────

  async list(query: OrderListQuery): Promise<Page<OrderListItem>> {
    const auth = currentAuth();
    const filters = buildListFilters(query);
    return this.db.read(async (tx) => {
      const sla = await this.slaHours(tx);
      const offset = (query.page - 1) * query.pageSize;

      // Sem filtro de farol: pagina os ids primeiro e só calcula faróis e nomes das linhas da página.
      if (!filters.needsSignals) {
        const ids = await tx.$queryRaw<{ id: string; total_count: bigint }[]>(orderIdsSql({ ...filters, limit: query.pageSize, offset }));
        // Página além do fim não traz linhas (nem o total da janela): só então conta separadamente.
        const total = ids.length
          ? Number(ids[0]!.total_count)
          : offset > 0
            ? Number((await tx.$queryRaw<{ total: bigint }[]>(orderCountSql(filters)))[0]?.total ?? 0)
            : 0;
        const rows = ids.length
          ? await tx.$queryRaw<OrderRow[]>(
              orderSelectSql({
                slaHours: sla,
                where: Prisma.sql`lo.id in (${Prisma.join(ids.map((r) => Prisma.sql`${r.id}::uuid`))})`,
                orderBy: filters.orderBy,
                limit: ids.length,
                offset: 0,
              }),
            )
          : [];
        return { items: rows.map((r) => toListItem(r, auth.membership!.scope)), total, page: query.page, pageSize: query.pageSize };
      }

      const rows = await tx.$queryRaw<OrderRow[]>(orderSelectSql({ slaHours: sla, ...filters, limit: query.pageSize, offset }));
      return {
        items: rows.map((r) => toListItem(r, auth.membership!.scope)),
        total: Number(rows[0]?.total_count ?? 0),
        page: query.page,
        pageSize: query.pageSize,
      };
    });
  }

  async summary(): Promise<OrdersSummary> {
    return this.db.read(async (tx) => {
      const sla = await this.slaHours(tx);
      const [row] = await tx.$queryRaw<
        {
          open: bigint;
          draft: bigint;
          published_today: bigint;
          awaiting_farm: bigint;
          awaiting_buyer: bigint;
          total_qty: Prisma.Decimal | null;
          released_qty: Prisma.Decimal | null;
          loaded_qty: Prisma.Decimal | null;
          received_qty: Prisma.Decimal | null;
          cancelled_qty: Prisma.Decimal | null;
        }[]
      >(Prisma.sql`
        with base as (
          select lo.*,
            (select max(v.version) from loading_order_views v where v.order_id = lo.id and v.side = 'FARM') as fv,
            (select max(v.version) from loading_order_views v where v.order_id = lo.id and v.side = 'BUYER') as bv
          from loading_orders lo
        )
        select
          count(*) filter (where status in ('PUBLISHED', 'IN_PROGRESS', 'SUSPENDED')) as open,
          count(*) filter (where status = 'DRAFT') as draft,
          count(*) filter (where published_at >= date_trunc('day', now())) as published_today,
          count(*) filter (where status in ('PUBLISHED', 'IN_PROGRESS') and seller_org_id is not null and coalesce(fv, 0) < version) as awaiting_farm,
          count(*) filter (where status in ('PUBLISHED', 'IN_PROGRESS') and buyer_org_id is not null and coalesce(bv, 0) < version) as awaiting_buyer,
          sum(quantity) filter (where status in ('PUBLISHED', 'IN_PROGRESS', 'SUSPENDED')) as total_qty,
          sum(released_qty) filter (where status in ('PUBLISHED', 'IN_PROGRESS', 'SUSPENDED')) as released_qty,
          sum(loaded_qty) filter (where status in ('PUBLISHED', 'IN_PROGRESS', 'SUSPENDED')) as loaded_qty,
          sum(received_qty) filter (where status in ('PUBLISHED', 'IN_PROGRESS', 'SUSPENDED')) as received_qty,
          sum(cancelled_qty) filter (where status in ('PUBLISHED', 'IN_PROGRESS', 'SUSPENDED')) as cancelled_qty
        from base
      `);
      void sla;
      const total = new Prisma.Decimal(row?.total_qty ?? 0);
      const loaded = new Prisma.Decimal(row?.loaded_qty ?? 0);
      const cancelled = new Prisma.Decimal(row?.cancelled_qty ?? 0);
      return {
        open: Number(row?.open ?? 0),
        draft: Number(row?.draft ?? 0),
        publishedToday: Number(row?.published_today ?? 0),
        awaitingFarmView: Number(row?.awaiting_farm ?? 0),
        awaitingBuyerView: Number(row?.awaiting_buyer ?? 0),
        totalQty: total.toString(),
        releasedQty: new Prisma.Decimal(row?.released_qty ?? 0).toString(),
        loadedQty: loaded.toString(),
        receivedQty: new Prisma.Decimal(row?.received_qty ?? 0).toString(),
        balanceQty: Prisma.Decimal.max(total.minus(loaded).minus(cancelled), 0).toString(),
      };
    });
  }

  async detail(id: string): Promise<OrderDetail> {
    return this.db.read((tx) => this.loadDetail(tx, id));
  }

  // ───────────────────────────── Escrita ─────────────────────────────

  async create(input: OrderDraftInput): Promise<OrderDetail> {
    const auth = currentAuth();
    return this.db.write(async (scope) => {
      const { tx } = scope;
      await this.validateRelations(tx, input);
      const now = new Date();
      const seq = await nextSequence(tx, auth.membership!.tenantId, 'loading_order', now.getUTCFullYear());
      const number = `${now.getUTCFullYear()}/${String(seq).padStart(5, '0')}`;
      const data = toPrismaData(input);
      const order = await tx.loadingOrder.create({
        data: {
          ...(data as Prisma.LoadingOrderUncheckedCreateInput),
          tenantId: auth.membership!.tenantId,
          number,
          status: 'DRAFT',
          version: 0,
          priority: input.priority ?? 'NORMAL',
          orderDate: data.orderDate ? (data.orderDate as Date) : new Date(`${now.toISOString().slice(0, 10)}T00:00:00.000Z`),
          createdBy: auth.userId,
          updatedBy: auth.userId,
        },
      });
      await scope.audit({ entityType: 'loading_order', entityId: order.id, action: 'order.created', after: { number, ...snapshot(order) } });
      return this.loadDetail(tx, order.id);
    });
  }

  async update(id: string, input: UpdateOrderInput): Promise<OrderDetail> {
    const auth = currentAuth();
    return this.db.write(async (scope) => {
      const { tx } = scope;
      const before = await this.lockForWrite(tx, id, input.expectedUpdatedAt);
      if (before.status === 'COMPLETED' || before.status === 'CANCELLED') {
        throw AppError.domain(ErrorCode.INVALID_TRANSITION, 'Ordens concluídas ou canceladas não podem ser alteradas.');
      }
      if (before.version !== input.expectedVersion) {
        throw AppError.conflict('Esta ordem foi alterada por outra pessoa. Recarregue para ver a versão atual.', ErrorCode.ORDER_STALE);
      }

      const merged = { ...before, ...toPrismaData(input.data) } as unknown as OrderRecord;
      await this.validateRelations(tx, merged as unknown as OrderDraftInput);

      const beforeNorm = Object.fromEntries(Object.keys(input.data).map((k) => [k, normalize(k, (before as Record<string, unknown>)[k])]));
      const afterNorm = Object.fromEntries(Object.entries(input.data).map(([k, v]) => [k, normalize(k, v)]));
      const changes = shallowDiff(beforeNorm, afterNorm);
      if (!changes.length) return this.loadDetail(tx, id);

      const isDraft = before.status === 'DRAFT';
      if (!isDraft) {
        this.assertPublishRequirements(merged);
        if (merged.quantity && compareDecimalStrings(new Prisma.Decimal(merged.quantity).toString(), before.releasedQty.toString()) < 0) {
          throw AppError.domain(ErrorCode.RELEASE_EXCEEDS_ORDER, 'A quantidade não pode ser menor que o total já liberado.', {
            fields: { quantity: [`Mínimo: ${before.releasedQty.toString()}`] },
          });
        }
      }

      const materialChanges = isDraft ? [] : changes.filter((c) => (ORDER_MATERIAL_FIELDS as readonly string[]).includes(c.field));
      const newVersion = materialChanges.length ? before.version + 1 : before.version;

      const updated = await tx.loadingOrder.update({
        where: { id },
        data: {
          ...toPrismaData(input.data),
          version: newVersion,
          updatedBy: auth.userId,
          ...(materialChanges.length ? { lastMaterialChangeAt: new Date() } : {}),
        },
      });

      if (materialChanges.length) {
        await this.createVersion(scope, updated, materialChanges);
      } else {
        await scope.audit({
          entityType: 'loading_order',
          entityId: id,
          action: isDraft ? 'order.draft_saved' : 'order.updated',
          before: Object.fromEntries(changes.map((c) => [c.field, c.from])),
          after: Object.fromEntries(changes.map((c) => [c.field, c.to])),
        });
      }
      return this.loadDetail(tx, id);
    });
  }

  async publish(id: string, expectedUpdatedAt: string): Promise<OrderDetail> {
    const auth = currentAuth();
    return this.db.write(async (scope) => {
      const { tx } = scope;
      const order = await this.lockForWrite(tx, id, expectedUpdatedAt);
      if (order.status !== 'DRAFT') {
        throw AppError.domain(ErrorCode.INVALID_TRANSITION, 'Somente rascunhos podem ser publicados.');
      }
      this.assertPublishRequirements(order);
      await this.validateRelations(tx, order as unknown as OrderDraftInput);
      await this.assertContractBalance(tx, order);

      const initial = order.initialReleaseQty ? new Prisma.Decimal(order.initialReleaseQty) : null;
      if (initial && initial.greaterThan(this.maxReleasable(order))) {
        throw AppError.domain(ErrorCode.RELEASE_EXCEEDS_ORDER, 'A liberação inicial excede a quantidade da ordem.', {
          fields: { initialReleaseQty: ['Maior que a quantidade da ordem (considerando a tolerância)'] },
        });
      }

      const now = new Date();
      const published = await tx.loadingOrder.update({
        where: { id },
        data: {
          status: 'PUBLISHED',
          version: 1,
          publishedAt: now,
          lastMaterialChangeAt: now,
          releasedQty: initial ?? 0,
          updatedBy: auth.userId,
        },
      });
      await tx.loadingOrderVersion.create({
        data: {
          tenantId: published.tenantId,
          orderId: id,
          version: 1,
          materialSnapshot: snapshot(published) as Prisma.InputJsonValue,
          createdBy: auth.userId,
        },
      });
      if (initial) {
        await tx.loadingOrderRelease.create({
          data: {
            tenantId: published.tenantId,
            orderId: id,
            sequence: 1,
            quantity: initial,
            orderVersion: 1,
            notes: 'Liberação inicial na publicação',
            createdBy: auth.userId,
          },
        });
      }
      await scope.audit({
        entityType: 'loading_order',
        entityId: id,
        action: 'order.published',
        before: { status: 'DRAFT' },
        after: { status: 'PUBLISHED', version: 1, initialRelease: initial?.toString() ?? null },
      });
      await scope.outbox({
        type: 'order.published',
        aggregateType: 'loading_order',
        aggregateId: id,
        payload: { orderId: id, number: published.number, version: 1, sellerOrgId: published.sellerOrgId, buyerOrgId: published.buyerOrgId },
      });
      return this.loadDetail(tx, id);
    });
  }

  async createRelease(id: string, input: CreateReleaseInput): Promise<OrderDetail> {
    const auth = currentAuth();
    return this.db.write(async (scope) => {
      const { tx } = scope;
      const order = await this.lockForWrite(tx, id, null);
      if (!['PUBLISHED', 'IN_PROGRESS'].includes(order.status)) {
        throw AppError.domain(ErrorCode.INVALID_TRANSITION, 'Liberações só podem ser criadas em ordens publicadas ou em execução.');
      }
      if (order.version !== input.expectedVersion) {
        throw AppError.conflict('Esta ordem foi alterada. Recarregue antes de liberar.', ErrorCode.ORDER_STALE);
      }
      const qty = new Prisma.Decimal(input.quantity);
      if (qty.lessThanOrEqualTo(0)) throw AppError.validation({ fields: { quantity: ['Informe uma quantidade positiva'] } });

      const agg = await tx.loadingOrderRelease.aggregate({
        where: { orderId: id, status: { in: ['ACTIVE', 'CONSUMED'] } },
        _sum: { quantity: true },
        _max: { sequence: true },
      });
      const releasedSoFar = new Prisma.Decimal(agg._sum.quantity ?? 0);
      const max = this.maxReleasable(order);
      if (releasedSoFar.plus(qty).greaterThan(max)) {
        const available = Prisma.Decimal.max(max.minus(releasedSoFar), 0).toString();
        throw AppError.domain(ErrorCode.RELEASE_EXCEEDS_ORDER, `A liberação excede o saldo liberável (${available}).`, {
          fields: { quantity: [`Disponível para liberar: ${available}`] },
          available,
        });
      }

      const newReleased = releasedSoFar.plus(qty);
      const sequence = (agg._max.sequence ?? 0) + 1;
      const updated = await tx.loadingOrder.update({
        where: { id },
        data: { releasedQty: newReleased, version: order.version + 1, lastMaterialChangeAt: new Date(), updatedBy: auth.userId },
      });
      const release = await tx.loadingOrderRelease.create({
        data: {
          tenantId: order.tenantId,
          orderId: id,
          sequence,
          quantity: qty,
          validUntil: input.validUntil ? new Date(`${input.validUntil}T00:00:00.000Z`) : null,
          notes: input.notes ?? null,
          orderVersion: updated.version,
          createdBy: auth.userId,
        },
      });
      await this.createVersion(scope, updated, [{ field: 'releasedQty', from: releasedSoFar.toString(), to: newReleased.toString() }], {
        releaseId: release.id,
        sequence,
      });
      await scope.audit({
        entityType: 'loading_order',
        entityId: id,
        action: 'order.release_created',
        after: { releaseId: release.id, sequence, quantity: qty.toString(), validUntil: input.validUntil ?? null, releasedTotal: newReleased.toString() },
      });
      await scope.outbox({
        type: 'order.release_created',
        aggregateType: 'loading_order',
        aggregateId: id,
        payload: { orderId: id, releaseId: release.id, sequence, quantity: qty.toString(), version: updated.version },
      });
      return this.loadDetail(tx, id);
    });
  }

  /**
   * Cancela uma liberação ativa (Q37). O total liberado restante, com tolerância, precisa cobrir
   * o que já foi agendado e carregado. Gera nova versão, auditoria e aviso à Fazenda na mesma transação.
   */
  async cancelRelease(id: string, releaseId: string, input: CancelReleaseInput): Promise<OrderDetail> {
    const auth = currentAuth();
    return this.db.write(async (scope) => {
      const { tx } = scope;
      const order = await this.lockForWrite(tx, id, null);
      const release = await tx.loadingOrderRelease.findFirst({ where: { id: releaseId, orderId: id } });
      if (!release) throw AppError.notFound('Liberação não encontrada.');
      if (release.status !== 'ACTIVE') {
        throw AppError.domain(ErrorCode.INVALID_TRANSITION, 'Somente liberações ativas podem ser canceladas.');
      }
      if (!ACTIVE_STATUSES.includes(order.status)) {
        throw AppError.domain(ErrorCode.INVALID_TRANSITION, 'A ordem não permite mais alterar liberações.');
      }
      if (order.version !== input.expectedVersion) {
        throw AppError.conflict('Esta ordem foi alterada. Recarregue antes de cancelar a liberação.', ErrorCode.ORDER_STALE);
      }

      const releasedBefore = new Prisma.Decimal(order.releasedQty);
      const remaining = Prisma.Decimal.max(releasedBefore.minus(release.quantity), 0);
      const committed = new Prisma.Decimal(order.scheduledQty).plus(order.loadedQty);
      const coverage = remaining.times(new Prisma.Decimal(order.tolerancePct).dividedBy(100).plus(1));
      if (coverage.lessThan(committed)) {
        throw AppError.domain(
          ErrorCode.RELEASE_BELOW_COMMITTED,
          `Não é possível cancelar: ${committed.toString()} já estão agendados ou carregados e o liberado restante não cobriria essa quantidade.`,
          { committed: committed.toString(), remaining: remaining.toString() },
        );
      }

      const updated = await tx.loadingOrder.update({
        where: { id },
        data: { releasedQty: remaining, version: order.version + 1, lastMaterialChangeAt: new Date(), updatedBy: auth.userId },
      });
      await tx.loadingOrderRelease.update({
        where: { id: releaseId },
        data: { status: 'CANCELLED', cancelledAt: new Date(), cancelledBy: auth.userId, cancelReason: input.reason },
      });
      await this.createVersion(scope, updated, [{ field: 'releasedQty', from: releasedBefore.toString(), to: remaining.toString() }], {
        releaseId,
        sequence: release.sequence,
        cancelled: true,
      });
      await scope.audit({
        entityType: 'loading_order',
        entityId: id,
        action: 'order.release_cancelled',
        before: { releaseId, sequence: release.sequence, status: 'ACTIVE', releasedTotal: releasedBefore.toString() },
        after: { releaseId, sequence: release.sequence, status: 'CANCELLED', quantity: release.quantity.toString(), reason: input.reason, releasedTotal: remaining.toString() },
      });
      await scope.outbox({
        type: 'order.release_cancelled',
        aggregateType: 'loading_order',
        aggregateId: id,
        payload: { orderId: id, releaseId, sequence: release.sequence, quantity: release.quantity.toString(), version: updated.version },
      });
      return this.loadDetail(tx, id);
    });
  }

  listReleases(query: ReleaseListQuery): Promise<Page<ReleaseListItem>> {
    const auth = currentAuth();
    const canCancel = auth.permissions.has('order.release') && auth.membership!.scope === 'MATRIZ';
    return this.db.read((tx) => listReleases(tx, query, canCancel));
  }

  releasesSummary(): Promise<ReleasesSummary> {
    return this.db.read((tx) => releasesSummary(tx));
  }

  /** Registra visualização efetiva (abertura do detalhe) por Fazenda ou Comprador. */
  async registerView(id: string): Promise<{ recorded: boolean; version: number | null }> {
    const auth = currentAuth();
    const m = auth.membership!;
    if (m.scope !== 'FARM' && m.scope !== 'BUYER') return { recorded: false, version: null };
    const req = currentRequest();

    return this.db.write(async (scope) => {
      const { tx } = scope;
      const order = await tx.loadingOrder.findUnique({ where: { id } });
      if (!order) throw AppError.notFound('Ordem não encontrada.');
      const sideOrg = m.scope === 'FARM' ? order.sellerOrgId : order.buyerOrgId;
      if (sideOrg !== m.organizationId) throw AppError.forbidden();

      const key = { orderId: id, organizationId: m.organizationId, userId: auth.userId, version: order.version };
      const existing = await tx.loadingOrderView.findUnique({ where: { orderId_organizationId_userId_version: key } });
      const tracking = { lastIp: req.ip, lastUserAgent: req.userAgent, lastSessionId: auth.sessionId, correlationId: req.correlationId };
      if (existing) {
        await tx.loadingOrderView.update({
          where: { id: existing.id },
          data: { viewCount: { increment: 1 }, lastViewedAt: new Date(), ...tracking },
        });
      } else {
        await tx.loadingOrderView.create({
          data: { ...key, tenantId: order.tenantId, side: m.scope, membershipId: m.id, ...tracking },
        });
        await scope.audit({ entityType: 'loading_order', entityId: id, action: 'order.viewed', after: { version: order.version, side: m.scope } });
        await scope.outbox({
          type: 'order.viewed',
          aggregateType: 'loading_order',
          aggregateId: id,
          payload: { orderId: id, side: m.scope, organizationId: m.organizationId, version: order.version },
        });
      }
      return { recorded: true, version: order.version };
    });
  }

  async versions(id: string): Promise<OrderVersionDto[]> {
    return this.db.read(async (tx) => {
      const rows = await tx.loadingOrderVersion.findMany({ where: { orderId: id }, orderBy: { version: 'desc' } });
      const names = await this.userNames(tx, rows.map((r) => r.createdBy));
      return rows.map((r) => ({
        version: r.version,
        changedFields: r.changedFields as OrderVersionDto['changedFields'],
        createdAt: r.createdAt.toISOString(),
        createdBy: r.createdBy ? (names.get(r.createdBy) ?? null) : null,
      }));
    });
  }

  async viewHistory(id: string): Promise<OrderViewHistoryItem[]> {
    return this.db.read(async (tx) => {
      const rows = await tx.$queryRaw<
        { organization: string; side: string; user: string | null; version: number; first_viewed_at: Date; last_viewed_at: Date; view_count: number }[]
      >(Prisma.sql`
        select o.name as organization, v.side::text as side, u.name as "user", v.version, v.first_viewed_at, v.last_viewed_at, v.view_count
        from loading_order_views v
        join organizations o on o.id = v.organization_id
        left join users u on u.id = v.user_id
        where v.order_id = ${id}::uuid
        order by v.last_viewed_at desc
      `);
      return rows.map((r) => ({
        organization: r.organization,
        side: r.side as 'FARM' | 'BUYER',
        user: r.user ?? 'Usuário',
        version: r.version,
        firstViewedAt: r.first_viewed_at.toISOString(),
        lastViewedAt: r.last_viewed_at.toISOString(),
        viewCount: r.view_count,
      }));
    });
  }

  async timeline(id: string): Promise<TimelineEventDto[]> {
    const scopeName = currentAuth().membership!.scope;
    return this.db.read(async (tx) => {
      const order = await tx.loadingOrder.findUnique({ where: { id }, select: { id: true } });
      if (!order) throw AppError.notFound('Ordem não encontrada.');
      const events = await tx.auditEvent.findMany({
        where: { entityType: 'loading_order', entityId: id, action: { not: 'order.viewed' } },
        orderBy: { occurredAt: 'asc' },
        take: 500,
      });
      const views = await tx.$queryRaw<{ id: string; first_viewed_at: Date; version: number; side: string; org: string; user: string | null }[]>(Prisma.sql`
        select distinct on (v.organization_id, v.version) v.id, v.first_viewed_at, v.version, v.side::text as side, o.name as org, u.name as "user"
        from loading_order_views v
        join organizations o on o.id = v.organization_id
        left join users u on u.id = v.user_id
        where v.order_id = ${id}::uuid
        order by v.organization_id, v.version, v.first_viewed_at
      `);
      const names = await this.userNames(tx, events.map((e) => e.actorUserId));
      const items: TimelineEventDto[] = events
        .filter((e) => scopeName === 'MATRIZ' || EXTERNAL_TIMELINE.has(e.action))
        .map((e) => ({
          id: `a-${e.id}`,
          at: e.occurredAt.toISOString(),
          action: e.action,
          label: TIMELINE_LABELS[e.action] ?? e.action,
          actor: e.actorUserId ? (names.get(e.actorUserId) ?? null) : null,
          organization: null,
          context: scopeName === 'MATRIZ' ? ((e.after as Record<string, unknown>) ?? null) : pickPublicContext(e.after),
        }));
      for (const v of views) {
        items.push({
          id: `v-${v.id}`,
          at: v.first_viewed_at.toISOString(),
          action: 'order.viewed',
          label: v.side === 'FARM' ? `Visualizada pela Fazenda (v${v.version})` : `Visualizada pelo Comprador (v${v.version})`,
          actor: v.user,
          organization: v.org,
          context: { version: v.version },
        });
      }
      return items.sort((a, b) => a.at.localeCompare(b.at));
    });
  }

  // ───────────────────────────── Internos ─────────────────────────────

  private async loadDetail(tx: Tx, id: string): Promise<OrderDetail> {
    const auth = currentAuth();
    const sla = await this.slaHours(tx);
    const rows = await tx.$queryRaw<OrderRow[]>(
      orderSelectSql({ slaHours: sla, where: Prisma.sql`lo.id = ${id}::uuid`, orderBy: Prisma.sql`o.id`, limit: 1, offset: 0 }),
    );
    const row = rows[0];
    if (!row) throw AppError.notFound('Ordem não encontrada.');

    const releases = await tx.loadingOrderRelease.findMany({ where: { orderId: id }, orderBy: { sequence: 'asc' } });
    const names = await this.userNames(tx, releases.flatMap((r) => [r.createdBy, r.cancelledBy]));
    const releaseDtos: ReleaseDto[] = releases.map((r) => ({
      id: r.id,
      sequence: r.sequence,
      quantity: dec(r.quantity)!,
      validUntil: day(r.validUntil),
      status: r.status,
      notes: r.notes,
      orderVersion: r.orderVersion,
      createdAt: r.createdAt.toISOString(),
      createdBy: r.createdBy ? (names.get(r.createdBy) ?? null) : null,
      cancelledAt: r.cancelledAt?.toISOString() ?? null,
      cancelledBy: r.cancelledBy ? (names.get(r.cancelledBy) ?? null) : null,
      // Motivo é interno: Fazenda e Comprador veem só que foi cancelada.
      cancelReason: auth.membership!.scope === 'MATRIZ' ? r.cancelReason : null,
    }));

    const perms = auth.permissions;
    const actions: string[] = [];
    const status = row.status;
    if (perms.has('order.update') && !['COMPLETED', 'CANCELLED'].includes(status)) actions.push('update');
    if (perms.has('order.publish') && status === 'DRAFT') actions.push('publish');
    if (perms.has('order.release') && ['PUBLISHED', 'IN_PROGRESS'].includes(status)) actions.push('release');
    if (perms.has('order.release') && ACTIVE_STATUSES.includes(status) && auth.membership!.scope === 'MATRIZ') actions.push('cancel_release');
    if (perms.has('order.cancel') && ACTIVE_STATUSES.includes(status)) actions.push('cancel');

    return toDetail(row, releaseDtos, auth.membership!.scope, actions);
  }

  /** Bloqueia a linha (SELECT … FOR UPDATE) e confere concorrência otimista por updatedAt. */
  private async lockForWrite(tx: Tx, id: string, expectedUpdatedAt: string | null): Promise<OrderRecord> {
    const locked = await tx.$queryRaw<{ id: string }[]>`select id from loading_orders where id = ${id}::uuid for update`;
    if (!locked.length) throw AppError.notFound('Ordem não encontrada.');
    const order = await tx.loadingOrder.findUniqueOrThrow({ where: { id } });
    if (expectedUpdatedAt && new Date(expectedUpdatedAt).getTime() !== order.updatedAt.getTime()) {
      throw AppError.conflict('Esta ordem foi alterada por outra pessoa. Recarregue para ver a versão atual.', ErrorCode.ORDER_STALE, {
        currentUpdatedAt: order.updatedAt.toISOString(),
        currentVersion: order.version,
      });
    }
    return order;
  }

  private assertPublishRequirements(order: Record<string, unknown> | OrderRecord) {
    const o = order as Record<string, unknown>;
    const missing = ORDER_PUBLISH_REQUIRED.filter((f) => o[f] === null || o[f] === undefined || o[f] === '');
    if (missing.length) {
      throw AppError.domain(ErrorCode.PUBLISH_REQUIREMENTS_MISSING, 'Preencha os campos obrigatórios para publicar.', {
        fields: Object.fromEntries(missing.map((f) => [f, [`${FIELD_LABELS[f] ?? f} é obrigatório para publicar`]])),
      });
    }
  }

  /** Impede combinações inconsistentes com mensagens por campo (o trigger do banco é a segunda barreira). */
  private async validateRelations(tx: Tx, o: Partial<OrderDraftInput>) {
    const fields: Record<string, string[]> = {};
    const partnerIds = [o.sellerPartnerId, o.buyerPartnerId, o.preferredCarrierId].filter((v): v is string => Boolean(v));
    const roles = partnerIds.length
      ? await tx.partnerRoleAssignment.findMany({ where: { partnerId: { in: partnerIds } } })
      : [];
    const hasRole = (id: string, role: string) => roles.some((r) => r.partnerId === id && r.role === role);

    if (o.sellerPartnerId && !hasRole(o.sellerPartnerId, 'SELLER')) fields.sellerPartnerId = ['Parceiro não é vendedor ou não está disponível'];
    if (o.buyerPartnerId && !hasRole(o.buyerPartnerId, 'BUYER')) fields.buyerPartnerId = ['Parceiro não é comprador ou não está disponível'];
    if (o.preferredCarrierId && !hasRole(o.preferredCarrierId, 'CARRIER')) {
      fields.preferredCarrierId = ['Parceiro não é transportadora ou não está disponível'];
    }

    if (o.farmId) {
      const farm = await tx.farm.findUnique({ where: { id: o.farmId }, select: { ownerPartnerId: true, name: true } });
      if (!farm) fields.farmId = ['Fazenda não encontrada'];
      else if (!o.sellerPartnerId) fields.farmId = ['Selecione o vendedor antes da fazenda'];
      else if (farm.ownerPartnerId !== o.sellerPartnerId) fields.farmId = [`${farm.name} não pertence ao vendedor selecionado`];
    }

    if (o.contractId) {
      const c = await tx.contract.findUnique({ where: { id: o.contractId } });
      if (!c) fields.contractId = ['Contrato não encontrado'];
      else {
        if (c.status !== 'ACTIVE') fields.contractId = ['Contrato não está ativo'];
        if (o.sellerPartnerId && o.sellerPartnerId !== c.sellerPartnerId) fields.sellerPartnerId = ['Vendedor diferente do contrato'];
        if (o.buyerPartnerId && o.buyerPartnerId !== c.buyerPartnerId) fields.buyerPartnerId = ['Comprador diferente do contrato'];
        if (o.commodityId && o.commodityId !== c.commodityId) fields.commodityId = ['Commodity diferente do contrato'];
      }
    }

    if (Object.keys(fields).length) {
      throw AppError.domain(ErrorCode.INCONSISTENT_RELATION, 'Há dados incompatíveis entre si.', { fields });
    }
  }

  private async assertContractBalance(tx: Tx, order: OrderRecord) {
    if (!order.contractId || !order.quantity) return;
    const contract = await tx.contract.findUniqueOrThrow({ where: { id: order.contractId } });
    const agg = await tx.loadingOrder.aggregate({
      where: { contractId: order.contractId, id: { not: order.id }, status: { notIn: ['DRAFT', 'CANCELLED'] } },
      _sum: { quantity: true },
    });
    const committed = new Prisma.Decimal(agg._sum.quantity ?? 0);
    const balance = contract.quantity.minus(committed);
    if (new Prisma.Decimal(order.quantity).greaterThan(balance)) {
      // Regra provisória Q1 (docs/decisions/open-questions.md): bloqueia.
      throw AppError.domain(ErrorCode.CONTRACT_BALANCE_EXCEEDED, `A quantidade excede o saldo do contrato (${balance.toString()}).`, {
        fields: { quantity: [`Saldo disponível no contrato: ${balance.toString()}`] },
        balance: balance.toString(),
      });
    }
  }

  private maxReleasable(order: OrderRecord): Prisma.Decimal {
    const qty = new Prisma.Decimal(order.quantity ?? 0);
    return qty.times(new Prisma.Decimal(order.tolerancePct).dividedBy(100).plus(1));
  }

  private async createVersion(
    scope: UnitOfWorkScope,
    order: OrderRecord,
    changes: { field: string; from: unknown; to: unknown }[],
    extra?: Record<string, unknown>,
  ) {
    await scope.tx.loadingOrderVersion.create({
      data: {
        tenantId: order.tenantId,
        orderId: order.id,
        version: order.version,
        materialSnapshot: { ...snapshot(order), releasedQty: order.releasedQty.toString() },
        changedFields: changes as Prisma.InputJsonValue,
        createdBy: currentAuth().userId,
      },
    });
    await scope.audit({
      entityType: 'loading_order',
      entityId: order.id,
      action: 'order.version_created',
      before: Object.fromEntries(changes.map((c) => [c.field, c.from])),
      after: { ...Object.fromEntries(changes.map((c) => [c.field, c.to])), version: order.version, ...extra },
    });
    await scope.outbox({
      type: 'order.version_created',
      aggregateType: 'loading_order',
      aggregateId: order.id,
      payload: { orderId: order.id, version: order.version, fields: changes.map((c) => c.field), sellerOrgId: order.sellerOrgId, buyerOrgId: order.buyerOrgId },
    });
  }

  private async slaHours(tx: Tx): Promise<number> {
    const tenant = await tx.tenant.findUnique({ where: { id: currentAuth().membership!.tenantId }, select: { viewSlaHours: true } });
    return tenant?.viewSlaHours ?? 24;
  }

  private async userNames(tx: Tx, ids: (string | null)[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids.filter((v): v is string => Boolean(v)))];
    if (!unique.length) return new Map();
    const users = await tx.user.findMany({ where: { id: { in: unique } }, select: { id: true, name: true } });
    return new Map(users.map((u) => [u.id, u.name]));
  }
}

function pickPublicContext(after: unknown): Record<string, unknown> | null {
  if (!after || typeof after !== 'object') return null;
  const a = after as Record<string, unknown>;
  const allowed = ['version', 'sequence', 'quantity', 'validUntil', 'releasedTotal', 'loadNumber', 'statusLabel', 'scheduledOn', 'plates', 'number'];
  return Object.fromEntries(Object.entries(a).filter(([k]) => allowed.includes(k)));
}
