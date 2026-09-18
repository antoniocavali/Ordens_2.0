import { Injectable } from '@nestjs/common';
import {
  BUYER_SUBMIT_REQUIRED,
  compareDecimalStrings,
  ErrorCode,
  ORDER_MATERIAL_FIELDS,
  ORDER_PUBLISH_REQUIRED,
  type AssignFarmInput,
  type BuyerOrderInput,
  type CancelReleaseInput,
  type CompleteOrderInput,
  type OrderCompletionCheck,
  type OrderReasonActionInput,
  type UpdateBuyerOrderInput,
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
import { recalcOrder } from '../logistics/logistics.util.js';
import { completeOrderRecord, pendingFiscalDocuments } from './order-completion.util.js';
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
  'order.submitted': 'Solicitação enviada ao Faturamento',
  'order.returned': 'Solicitação devolvida ao Comprador',
  'order.suspended': 'Ordem suspensa',
  'order.completed': 'Ordem concluída',
  'order.resumed': 'Ordem retomada',
  'order.cancelled': 'Ordem cancelada',
  'order.cancelled_by_buyer': 'Solicitação cancelada pelo Comprador',
  'order.billing_updated': 'Solicitação complementada pelo Faturamento',
  'order.farm_assigned': 'Fazenda definida pelo Faturamento',
  'order.load_document_attached': 'Documento fiscal anexado à carga',
  'order.load_documents_validated': 'Documentação fiscal da carga validada',
  'order.load_matriz_invoiced': 'Carga faturada pela Matriz',
  'order.publish_requested': 'Publicação solicitada',
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
  'order.submitted',
  'order.returned',
  'order.cancelled_by_buyer',
  'order.suspended',
  'order.resumed',
  'order.cancelled',
  'order.load_document_attached',
  'order.load_documents_validated',
  'order.load_matriz_invoiced',
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

const REASON_VISIBLE_TO_BUYER = new Set(['order.returned', 'order.cancelled_by_buyer', 'order.suspended', 'order.cancelled']);

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
const NON_NULLABLE_DEFAULTS: Record<string, unknown> = { tolerancePct: '0', requiresReceipt: true, currency: 'BRL', priority: 'NORMAL' };

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
    this.assertInternal();
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
    this.assertInternal();
    return this.db.write(async (scope) => {
      const { tx } = scope;
      const before = await this.lockForWrite(tx, id, input.expectedUpdatedAt);
      if (before.status === 'COMPLETED' || before.status === 'CANCELLED') {
        throw AppError.domain(ErrorCode.INVALID_TRANSITION, 'Ordens concluídas ou canceladas não podem ser alteradas.');
      }
      if (before.version !== input.expectedVersion) {
        throw AppError.conflict('Esta ordem foi alterada por outra pessoa. Recarregue para ver a versão atual.', ErrorCode.ORDER_STALE);
      }

      // Solicitação do Comprador: o comprador vem da organização que pediu e não é trocado pela Matriz.
      if (before.origin === 'BUYER' && input.data.buyerPartnerId !== undefined && input.data.buyerPartnerId !== before.buyerPartnerId) {
        throw AppError.domain(ErrorCode.INCONSISTENT_RELATION, 'O comprador de uma solicitação do portal não pode ser alterado.', {
          fields: { buyerPartnerId: ['Definido pela organização que enviou a solicitação'] },
        });
      }
      const merged = { ...before, ...toPrismaData(input.data) } as unknown as OrderRecord;
      await this.validateRelations(tx, merged as unknown as OrderDraftInput);

      const beforeNorm = Object.fromEntries(Object.keys(input.data).map((k) => [k, normalize(k, (before as Record<string, unknown>)[k])]));
      const afterNorm = Object.fromEntries(Object.entries(input.data).map(([k, v]) => [k, normalize(k, v)]));
      const changes = shallowDiff(beforeNorm, afterNorm);
      if (!changes.length) return this.loadDetail(tx, id);

      // Aguardando faturamento ainda não foi publicada: sem versões nem faróis.
      const isDraft = before.status === 'DRAFT' || before.status === 'PENDING_BILLING';
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
          action: before.status === 'PENDING_BILLING' ? 'order.billing_updated' : isDraft ? 'order.draft_saved' : 'order.updated',
          before: Object.fromEntries(changes.map((c) => [c.field, c.from])),
          after: Object.fromEntries(changes.map((c) => [c.field, c.to])),
        });
      }
      return this.loadDetail(tx, id);
    });
  }

  /**
   * Quem monta a ordem sem poder publicar (ou barrado pela dupla checagem) pede a publicação (Q40).
   * Valida os requisitos de publicação agora, para quem aprova não receber rascunho incompleto.
   */
  async requestPublish(id: string, expectedUpdatedAt: string): Promise<OrderDetail> {
    const auth = currentAuth();
    this.assertInternal();
    return this.db.write(async (scope) => {
      const { tx } = scope;
      const order = await this.lockForWrite(tx, id, expectedUpdatedAt);
      if (order.status !== 'DRAFT') throw AppError.domain(ErrorCode.INVALID_TRANSITION, 'Somente rascunhos podem ter a publicação solicitada.');
      if (order.origin === 'BUYER') throw AppError.domain(ErrorCode.INVALID_TRANSITION, 'Solicitações do Comprador seguem pelo Faturamento.');
      this.assertPublishRequirements(order);
      await this.validateRelations(tx, order as unknown as OrderDraftInput);
      const now = new Date();
      await tx.loadingOrder.update({ where: { id }, data: { publishRequestedAt: now, publishRequestedBy: auth.userId } });
      await scope.audit({
        entityType: 'loading_order',
        entityId: id,
        action: 'order.publish_requested',
        before: { publishRequestedAt: order.publishRequestedAt?.toISOString() ?? null },
        after: { publishRequestedAt: now.toISOString() },
      });
      await scope.outbox({
        type: 'order.publish_requested',
        aggregateType: 'loading_order',
        aggregateId: id,
        payload: { orderId: id, number: order.number, requestedBy: auth.userId },
      });
      return this.loadDetail(tx, id);
    });
  }

  async publish(id: string, expectedUpdatedAt: string): Promise<OrderDetail> {
    const auth = currentAuth();
    this.assertInternal();
    return this.db.write(async (scope) => {
      const { tx } = scope;
      const order = await this.lockForWrite(tx, id, expectedUpdatedAt);
      if (order.status !== 'DRAFT') {
        throw AppError.domain(
          ErrorCode.INVALID_TRANSITION,
          order.status === 'PENDING_BILLING' ? 'Solicitações do Comprador são publicadas pelo Faturamento.' : 'Somente rascunhos podem ser publicados.',
        );
      }
      if (order.origin === 'BUYER') {
        throw AppError.domain(ErrorCode.INVALID_TRANSITION, 'O Comprador ainda não enviou esta solicitação ao Faturamento.');
      }
      this.assertPublishRequirements(order);
      await this.validateRelations(tx, order as unknown as OrderDraftInput);
      await this.assertContractBalance(tx, order);
      const fourEyes = await this.fourEyes(tx, order, auth.userId);
      if (fourEyes.blocked) {
        throw AppError.domain(
          ErrorCode.FOUR_EYES_REQUIRED,
          'Dupla checagem ativa: outra pessoa precisa publicar, porque você fez a última alteração. Use "Solicitar publicação".',
        );
      }
      return this.publishInScope(scope, order, 'MATRIZ');
    });
  }

  /** Publicação: versão 1, liberação inicial, auditoria e aviso às partes. Quem chama valida status e requisitos. */
  private async publishInScope(scope: UnitOfWorkScope, order: OrderRecord, via: 'MATRIZ' | 'BILLING'): Promise<OrderDetail> {
    const auth = currentAuth();
    const { tx } = scope;
    const id = order.id;
    {
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
        before: { status: order.status },
        after: { status: 'PUBLISHED', version: 1, initialRelease: initial?.toString() ?? null, via, farmId: published.farmId },
      });
      await scope.outbox({
        type: 'order.published',
        aggregateType: 'loading_order',
        aggregateId: id,
        payload: { orderId: id, number: published.number, version: 1, sellerOrgId: published.sellerOrgId, buyerOrgId: published.buyerOrgId, via },
      });
      return this.loadDetail(tx, id);
    }
  }

  async createRelease(id: string, input: CreateReleaseInput): Promise<OrderDetail> {
    const auth = currentAuth();
    this.assertInternal();
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

  // ───────────────────────────── Portal do Comprador (Q41) ─────────────────────────────

  /** Comprador cria a solicitação. O comprador vem da organização ativa; nunca do payload. */
  async createBuyerOrder(input: BuyerOrderInput): Promise<OrderDetail> {
    const auth = currentAuth();
    const m = this.assertBuyer();
    return this.db.write(async (scope) => {
      const { tx } = scope;
      const buyerPartnerId = await this.buyerPartnerOf(tx, m.organizationId);
      await this.validateBuyerFields(tx, input);
      const now = new Date();
      const seq = await nextSequence(tx, m.tenantId, 'loading_order', now.getUTCFullYear());
      const number = `${now.getUTCFullYear()}/${String(seq).padStart(5, '0')}`;
      const order = await tx.loadingOrder.create({
        data: {
          ...(toPrismaData(input as OrderDraftInput) as Prisma.LoadingOrderUncheckedCreateInput),
          tenantId: m.tenantId,
          number,
          status: 'DRAFT',
          origin: 'BUYER',
          version: 0,
          priority: 'NORMAL',
          buyerPartnerId,
          orderDate: new Date(`${now.toISOString().slice(0, 10)}T00:00:00.000Z`),
          createdBy: auth.userId,
          updatedBy: auth.userId,
        },
      });
      await scope.audit({ entityType: 'loading_order', entityId: order.id, action: 'order.created', after: { number, origin: 'BUYER', ...snapshot(order) } });
      return this.loadDetail(tx, order.id);
    });
  }

  /** Comprador altera somente os próprios rascunhos, e só os campos do portal. */
  async updateBuyerOrder(id: string, input: UpdateBuyerOrderInput): Promise<OrderDetail> {
    const auth = currentAuth();
    this.assertBuyer();
    return this.db.write(async (scope) => {
      const { tx } = scope;
      this.assertOwnBuyerDraft(await tx.loadingOrder.findUnique({ where: { id } }), auth.userId);
      const before = await this.lockForWrite(tx, id, input.expectedUpdatedAt);
      await this.validateBuyerFields(tx, input.data);
      const beforeNorm = Object.fromEntries(Object.keys(input.data).map((k) => [k, normalize(k, (before as Record<string, unknown>)[k])]));
      const afterNorm = Object.fromEntries(Object.entries(input.data).map(([k, v]) => [k, normalize(k, v)]));
      const changes = shallowDiff(beforeNorm, afterNorm);
      if (!changes.length) return this.loadDetail(tx, id);
      await tx.loadingOrder.update({ where: { id }, data: { ...toPrismaData(input.data as OrderDraftInput), updatedBy: auth.userId } });
      await scope.audit({
        entityType: 'loading_order',
        entityId: id,
        action: 'order.draft_saved',
        before: Object.fromEntries(changes.map((c) => [c.field, c.from])),
        after: Object.fromEntries(changes.map((c) => [c.field, c.to])),
      });
      return this.loadDetail(tx, id);
    });
  }

  /** Comprador envia ao Faturamento: a solicitação fica travada para ele e visível só à Matriz e ao próprio Comprador. */
  async submitOrder(id: string, expectedUpdatedAt: string): Promise<OrderDetail> {
    const auth = currentAuth();
    const m = this.assertBuyer();
    return this.db.write(async (scope) => {
      const { tx } = scope;
      this.assertOwnBuyerDraft(await tx.loadingOrder.findUnique({ where: { id } }), auth.userId);
      const order = await this.lockForWrite(tx, id, expectedUpdatedAt);
      if (order.buyerOrgId !== m.organizationId) throw AppError.forbidden('Solicitação de outra organização.');
      const o = order as unknown as Record<string, unknown>;
      const missing = BUYER_SUBMIT_REQUIRED.filter((f) => o[f] === null || o[f] === undefined || o[f] === '');
      if (missing.length) {
        throw AppError.domain(ErrorCode.PUBLISH_REQUIREMENTS_MISSING, 'Preencha os campos obrigatórios antes de enviar ao Faturamento.', {
          fields: Object.fromEntries(missing.map((f) => [f, [`${FIELD_LABELS[f] ?? f} é obrigatório para enviar`]])),
        });
      }
      const now = new Date();
      await tx.loadingOrder.update({ where: { id }, data: { status: 'PENDING_BILLING', submittedAt: now, submittedBy: auth.userId, updatedBy: auth.userId } });
      await scope.audit({ entityType: 'loading_order', entityId: id, action: 'order.submitted', before: { status: 'DRAFT' }, after: { status: 'PENDING_BILLING', submittedAt: now.toISOString() } });
      await scope.outbox({
        type: 'order.submitted',
        aggregateType: 'loading_order',
        aggregateId: id,
        payload: { orderId: id, number: order.number, buyerOrgId: order.buyerOrgId, submittedBy: auth.userId },
      });
      return this.loadDetail(tx, id);
    });
  }

  /**
   * Comprador cancela com motivo o próprio rascunho ou a solicitação enviada antes da análise
   * (fazenda ainda não definida). Depois disso, só a Matriz decide.
   */
  async cancelBuyerOrder(id: string, input: OrderReasonActionInput): Promise<OrderDetail> {
    const auth = currentAuth();
    this.assertBuyer();
    return this.db.write(async (scope) => {
      const { tx } = scope;
      const current = await tx.loadingOrder.findUnique({ where: { id } });
      if (!current) throw AppError.notFound('Ordem não encontrada.');
      if (current.origin !== 'BUYER' || current.createdBy !== auth.userId) throw AppError.forbidden('Você só cancela as solicitações que criou.');
      if (current.status === 'PENDING_BILLING' && (current.farmId || current.sellerPartnerId)) {
        throw AppError.domain(ErrorCode.INVALID_TRANSITION, 'O Faturamento já iniciou a análise (fazenda definida): peça o cancelamento à Matriz.');
      }
      if (current.status !== 'DRAFT' && current.status !== 'PENDING_BILLING') {
        throw AppError.domain(ErrorCode.INVALID_TRANSITION, 'Esta solicitação não pode mais ser cancelada pelo Comprador.');
      }
      const order = await this.lockForWrite(tx, id, input.expectedUpdatedAt);
      const now = new Date();
      await tx.loadingOrder.update({
        where: { id },
        data: { status: 'CANCELLED', cancelledAt: now, cancelledBy: auth.userId, cancelReason: input.reason, updatedBy: auth.userId },
      });
      await scope.audit({ entityType: 'loading_order', entityId: id, action: 'order.cancelled_by_buyer', before: { status: order.status }, after: { status: 'CANCELLED', reason: input.reason } });
      if (order.status === 'PENDING_BILLING') {
        await scope.outbox({
          type: 'order.cancelled_by_buyer',
          aggregateType: 'loading_order',
          aggregateId: id,
          payload: { orderId: id, number: order.number, cancelledBy: auth.userId, reason: input.reason },
        });
      }
      return this.loadDetail(tx, id);
    });
  }

  // ───────────────────────────── Suspensão e cancelamento (Matriz) ─────────────────────────────

  /** Suspende ordem publicada ou em execução: bloqueia liberações, agendamentos e cargas novas até a retomada. */
  async suspendOrder(id: string, input: OrderReasonActionInput): Promise<OrderDetail> {
    const auth = currentAuth();
    this.assertInternal();
    return this.db.write(async (scope) => {
      const { tx } = scope;
      const order = await this.lockForWrite(tx, id, null);
      this.assertExpected(order, input.expectedUpdatedAt);
      if (order.status !== 'PUBLISHED' && order.status !== 'IN_PROGRESS') {
        throw AppError.domain(ErrorCode.INVALID_TRANSITION, 'Somente ordens publicadas ou em execução podem ser suspensas.');
      }
      const now = new Date();
      await tx.loadingOrder.update({ where: { id }, data: { status: 'SUSPENDED', suspendedAt: now, suspendedBy: auth.userId, suspendReason: input.reason, updatedBy: auth.userId } });
      await scope.audit({ entityType: 'loading_order', entityId: id, action: 'order.suspended', before: { status: order.status }, after: { status: 'SUSPENDED', reason: input.reason } });
      await scope.outbox({ type: 'order.suspended', aggregateType: 'loading_order', aggregateId: id, payload: { orderId: id, number: order.number, reason: input.reason } });
      return this.loadDetail(tx, id);
    });
  }

  /** Conferência prévia da conclusão: cargas ativas, documentação pendente e saldo (Q45). */
  async completionCheck(id: string): Promise<OrderCompletionCheck> {
    this.assertInternal();
    return this.db.read(async (tx) => {
      const order = await tx.loadingOrder.findUniqueOrThrow({ where: { id } });
      const unit = order.unitId ? await tx.unit.findUnique({ where: { id: order.unitId }, select: { code: true } }) : null;
      const [activeLoads, loadsTotal, pendingDocuments] = await Promise.all([
        tx.load.findMany({ where: { orderId: id, status: { notIn: ['COMPLETED', 'CANCELLED'] } }, select: { number: true }, orderBy: { sequence: 'asc' } }),
        tx.load.count({ where: { orderId: id, status: { not: 'CANCELLED' } } }),
        pendingFiscalDocuments(tx, id),
      ]);
      const balance = Prisma.Decimal.max(new Prisma.Decimal(order.quantity ?? 0).minus(order.loadedQty).minus(order.cancelledQty), 0);
      return {
        activeLoads: activeLoads.map((l) => l.number),
        pendingDocuments,
        balance: balance.toString(),
        unit: unit?.code === 'T' ? 't' : (unit?.code?.toLowerCase() ?? ''),
        loadsTotal,
      };
    });
  }

  /**
   * Conclusão informada pela Matriz (Q45). Exige cargas encerradas; cargas sem PDF e XML validados da Fazenda
   * só passam com aceite explícito, e sobra de saldo exige motivo.
   */
  async completeOrder(id: string, input: CompleteOrderInput): Promise<OrderDetail> {
    this.assertInternal();
    return this.db.write(async (scope) => {
      const { tx } = scope;
      const order = await this.lockForWrite(tx, id, null);
      this.assertExpected(order, input.expectedUpdatedAt);
      if (order.status !== 'IN_PROGRESS' && order.status !== 'PUBLISHED') {
        throw AppError.domain(ErrorCode.INVALID_TRANSITION, 'Somente ordens publicadas ou em execução podem ser concluídas.');
      }
      const activeLoads = await tx.load.findMany({ where: { orderId: id, status: { notIn: ['COMPLETED', 'CANCELLED'] } }, select: { number: true } });
      if (activeLoads.length) {
        throw AppError.domain(
          ErrorCode.INVALID_TRANSITION,
          `Há ${activeLoads.length} carga(s) em andamento (${activeLoads.map((l) => l.number).join(', ')}): encerre antes de concluir a ordem.`,
          { activeLoads: activeLoads.map((l) => l.number) },
        );
      }
      const pendingDocuments = await pendingFiscalDocuments(tx, id);
      if (pendingDocuments.length && !input.acceptPendingDocuments) {
        throw AppError.domain(
          ErrorCode.ORDER_DOCUMENTS_PENDING,
          `${pendingDocuments.length} carga(s) sem PDF e XML da Fazenda validados. Confirme a conclusão mesmo assim ou aguarde os documentos.`,
          { pendingDocuments },
        );
      }
      const fresh = await recalcOrder(tx, id);
      const balance = Prisma.Decimal.max(new Prisma.Decimal(fresh.quantity ?? 0).minus(fresh.loadedQty).minus(fresh.cancelledQty), 0);
      const reason = input.reason?.trim() || null;
      if (balance.greaterThan(0) && !reason) {
        throw AppError.validation({ fields: { reason: ['Informe o motivo da conclusão com saldo a carregar'] } }, 'Informe o motivo da conclusão com saldo a carregar.');
      }
      await completeOrderRecord(scope, id, {
        reason,
        acceptedPendingDocuments: pendingDocuments.length > 0,
        via: 'manual',
        previousStatus: order.status as 'PUBLISHED' | 'IN_PROGRESS',
        number: order.number,
        balance: balance.toString(),
      });
      return this.loadDetail(tx, id);
    });
  }

  /** Retoma a ordem: em execução se já houve carga (não cancelada), senão publicada. */
  async resumeOrder(id: string, expectedUpdatedAt: string): Promise<OrderDetail> {
    const auth = currentAuth();
    this.assertInternal();
    return this.db.write(async (scope) => {
      const { tx } = scope;
      const order = await this.lockForWrite(tx, id, null);
      this.assertExpected(order, expectedUpdatedAt);
      if (order.status !== 'SUSPENDED') throw AppError.domain(ErrorCode.INVALID_TRANSITION, 'Somente ordens suspensas podem ser retomadas.');
      const loads = await tx.load.count({ where: { orderId: id, status: { not: 'CANCELLED' } } });
      const to = loads ? 'IN_PROGRESS' : 'PUBLISHED';
      await tx.loadingOrder.update({ where: { id }, data: { status: to, suspendedAt: null, suspendedBy: null, suspendReason: null, updatedBy: auth.userId } });
      await scope.audit({ entityType: 'loading_order', entityId: id, action: 'order.resumed', before: { status: 'SUSPENDED', reason: order.suspendReason }, after: { status: to } });
      await scope.outbox({ type: 'order.resumed', aggregateType: 'loading_order', aggregateId: id, payload: { orderId: id, number: order.number, status: to } });
      return this.loadDetail(tx, id);
    });
  }

  /**
   * Cancela a ordem (rascunho interno, aguardando faturamento, publicada, em execução ou suspensa). Exige que não haja
   * carga ativa; agendamentos e liberações ativos são cancelados junto e o saldo não carregado vira "cancelado".
   * Cargas concluídas são mantidas.
   */
  async cancelOrder(id: string, input: OrderReasonActionInput): Promise<OrderDetail> {
    const auth = currentAuth();
    this.assertInternal();
    return this.db.write(async (scope) => {
      const { tx } = scope;
      const order = await this.lockForWrite(tx, id, null);
      this.assertExpected(order, input.expectedUpdatedAt);
      const cancellable = ['PENDING_BILLING', 'PUBLISHED', 'IN_PROGRESS', 'SUSPENDED'].includes(order.status) || (order.status === 'DRAFT' && order.origin === 'MATRIZ');
      if (!cancellable) throw AppError.domain(ErrorCode.INVALID_TRANSITION, 'Esta ordem não pode ser cancelada.');
      const activeLoads = await tx.load.findMany({ where: { orderId: id, status: { notIn: ['COMPLETED', 'CANCELLED'] } }, select: { number: true } });
      if (activeLoads.length) {
        throw AppError.domain(
          ErrorCode.INVALID_TRANSITION,
          `Há ${activeLoads.length} carga(s) em andamento (${activeLoads.map((l) => l.number).join(', ')}): conclua ou cancele antes de cancelar a ordem.`,
          { activeLoads: activeLoads.map((l) => l.number) },
        );
      }
      const now = new Date();
      const note = `Ordem cancelada: ${input.reason}`;
      const appointments = await tx.appointment.updateMany({
        where: { orderId: id, status: { in: ['REQUESTED', 'CONFIRMED', 'CHECKED_IN'] } },
        data: { status: 'CANCELLED', cancelReason: note },
      });
      const releases = await tx.loadingOrderRelease.updateMany({
        where: { orderId: id, status: 'ACTIVE' },
        data: { status: 'CANCELLED', cancelledAt: now, cancelledBy: auth.userId, cancelReason: note },
      });
      await recalcOrder(tx, id);
      const fresh = await tx.loadingOrder.findUniqueOrThrow({ where: { id }, select: { quantity: true, loadedQty: true } });
      const cancelledQty = Prisma.Decimal.max(new Prisma.Decimal(fresh.quantity ?? 0).minus(fresh.loadedQty), 0);
      await tx.loadingOrder.update({
        where: { id },
        data: { status: 'CANCELLED', cancelledAt: now, cancelledBy: auth.userId, cancelReason: input.reason, cancelledQty, suspendedAt: null, suspendedBy: null, suspendReason: null, updatedBy: auth.userId },
      });
      await scope.audit({
        entityType: 'loading_order',
        entityId: id,
        action: 'order.cancelled',
        before: { status: order.status },
        after: { status: 'CANCELLED', reason: input.reason, cancelledQty: cancelledQty.toString(), appointmentsCancelled: appointments.count, releasesCancelled: releases.count },
      });
      await scope.outbox({
        type: 'order.cancelled',
        aggregateType: 'loading_order',
        aggregateId: id,
        payload: { orderId: id, number: order.number, reason: input.reason, previousStatus: order.status, createdBy: order.createdBy, origin: order.origin },
      });
      return this.loadDetail(tx, id);
    });
  }

  private assertExpected(order: OrderRecord, expectedUpdatedAt: string) {
    if (new Date(expectedUpdatedAt).getTime() !== order.updatedAt.getTime()) {
      throw AppError.conflict('Esta ordem foi alterada por outra pessoa. Recarregue para continuar.', ErrorCode.ORDER_STALE);
    }
  }

  // ───────────────────────────── Faturamento da Matriz (Q41) ─────────────────────────────

  /**
   * Faturamento devolve a solicitação ao Comprador com motivo: volta a rascunho editável por quem criou e
   * descarta os dados da análise (vendedor, fazenda, contrato, preço e campos internos).
   */
  async returnToBuyer(id: string, input: OrderReasonActionInput): Promise<OrderDetail> {
    const auth = currentAuth();
    this.assertInternal();
    return this.db.write(async (scope) => {
      const { tx } = scope;
      const order = await this.lockForWrite(tx, id, input.expectedUpdatedAt);
      if (order.status !== 'PENDING_BILLING') {
        throw AppError.domain(ErrorCode.INVALID_TRANSITION, 'Somente solicitações aguardando faturamento podem ser devolvidas ao Comprador.');
      }
      const now = new Date();
      await tx.loadingOrder.update({
        where: { id },
        data: {
          status: 'DRAFT',
          submittedAt: null,
          submittedBy: null,
          returnedAt: now,
          returnedBy: auth.userId,
          returnReason: input.reason,
          sellerPartnerId: null,
          farmId: null,
          contractId: null,
          unitPrice: null,
          freightEstimate: null,
          internalNotes: null,
          farmNotes: null,
          commercialTerms: null,
          loadingInstructions: null,
          initialReleaseQty: null,
          operationType: null,
          tolerancePct: '0',
          requiresReceipt: true,
          updatedBy: auth.userId,
        },
      });
      await scope.audit({
        entityType: 'loading_order',
        entityId: id,
        action: 'order.returned',
        before: { status: 'PENDING_BILLING', sellerPartnerId: order.sellerPartnerId, farmId: order.farmId, contractId: order.contractId },
        after: { status: 'DRAFT', reason: input.reason },
      });
      await scope.outbox({
        type: 'order.returned',
        aggregateType: 'loading_order',
        aggregateId: id,
        payload: { orderId: id, number: order.number, buyerUserId: order.createdBy, returnedBy: auth.userId, reason: input.reason },
      });
      return this.loadDetail(tx, id);
    });
  }

  /** Faturamento complementa a solicitação e define vendedor/fazenda; a ordem segue aguardando faturamento. */
  async assignFarm(id: string, input: AssignFarmInput): Promise<OrderDetail> {
    const auth = currentAuth();
    this.assertInternal();
    return this.db.write(async (scope) => {
      const { tx } = scope;
      const order = await this.lockForWrite(tx, id, input.expectedUpdatedAt);
      if (order.status !== 'PENDING_BILLING') {
        throw AppError.domain(ErrorCode.INVALID_TRANSITION, 'Vendedor e fazenda são definidos enquanto a solicitação aguarda faturamento.');
      }
      const data: Record<string, unknown> = { sellerPartnerId: input.sellerPartnerId, farmId: input.farmId };
      for (const key of ['contractId', 'unitPrice', 'loadingInstructions', 'farmNotes', 'internalNotes'] as const) {
        if (input[key] !== undefined) data[key] = input[key];
      }
      if (input.tolerancePct !== undefined) data.tolerancePct = input.tolerancePct ?? '0';
      if (input.requiresReceipt !== undefined) data.requiresReceipt = input.requiresReceipt;
      const merged = { ...order, ...data } as unknown as OrderDraftInput;
      await this.validateRelations(tx, merged);
      await tx.loadingOrder.update({ where: { id }, data: { ...(data as Prisma.LoadingOrderUncheckedUpdateInput), updatedBy: auth.userId } });
      await scope.audit({
        entityType: 'loading_order',
        entityId: id,
        action: 'order.farm_assigned',
        before: { sellerPartnerId: order.sellerPartnerId, farmId: order.farmId, contractId: order.contractId },
        after: { sellerPartnerId: input.sellerPartnerId, farmId: input.farmId, contractId: (data.contractId as string | null | undefined) ?? order.contractId },
      });
      return this.loadDetail(tx, id);
    });
  }

  /**
   * Faturamento publica a solicitação para a Fazenda: exige vendedor, fazenda e demais requisitos de publicação,
   * valida contrato e saldo. Sem dupla checagem: o pedido do Comprador e a análise do Faturamento já são dois olhares.
   */
  async billingPublish(id: string, expectedUpdatedAt: string): Promise<OrderDetail> {
    this.assertInternal();
    return this.db.write(async (scope) => {
      const { tx } = scope;
      const order = await this.lockForWrite(tx, id, expectedUpdatedAt);
      if (order.status !== 'PENDING_BILLING') throw AppError.domain(ErrorCode.INVALID_TRANSITION, 'Somente solicitações aguardando faturamento são publicadas por aqui.');
      if (!order.farmId || !order.sellerPartnerId) {
        throw AppError.domain(ErrorCode.PUBLISH_REQUIREMENTS_MISSING, 'Defina vendedor e fazenda antes de publicar para a Fazenda.', {
          fields: { farmId: ['Fazenda é obrigatória para publicar'] },
        });
      }
      this.assertPublishRequirements(order);
      await this.validateRelations(tx, order as unknown as OrderDraftInput);
      await this.assertContractBalance(tx, order);
      return this.publishInScope(scope, order, 'BILLING');
    });
  }

  private assertInternal() {
    if (currentAuth().membership?.scope !== 'MATRIZ') throw AppError.forbidden('Somente a Matriz executa esta ação.');
  }

  private assertBuyer() {
    const m = currentAuth().membership;
    if (!m || m.scope !== 'BUYER') throw AppError.forbidden('Ação exclusiva do portal do Comprador.');
    return m;
  }

  private assertOwnBuyerDraft(order: OrderRecord | null, userId: string) {
    if (!order) throw AppError.notFound('Ordem não encontrada.');
    if (order.origin !== 'BUYER' || order.createdBy !== userId) throw AppError.forbidden('Você só altera as solicitações que criou.');
    if (order.status !== 'DRAFT') {
      throw AppError.domain(ErrorCode.INVALID_TRANSITION, 'Solicitação já enviada ao Faturamento: não pode mais ser alterada.');
    }
  }

  /** Parceiro comprador vinculado à organização ativa (nunca aceito do payload). */
  private async buyerPartnerOf(tx: Tx, organizationId: string): Promise<string> {
    const org = await tx.organization.findUnique({ where: { id: organizationId }, select: { kind: true, partnerId: true } });
    if (!org || org.kind !== 'BUYER' || !org.partnerId) throw AppError.forbidden('Sua organização não está vinculada a um comprador cadastrado.');
    const role = await tx.partnerRoleAssignment.findFirst({ where: { partnerId: org.partnerId, role: 'BUYER' } });
    if (!role) throw AppError.forbidden('Sua organização não está vinculada a um comprador cadastrado.');
    return org.partnerId;
  }

  private async validateBuyerFields(tx: Tx, i: Partial<BuyerOrderInput>) {
    const fields: Record<string, string[]> = {};
    if (i.commodityId) {
      const c = await tx.commodity.findUnique({ where: { id: i.commodityId }, select: { status: true } });
      if (!c || c.status !== 'ACTIVE') fields.commodityId = ['Commodity não encontrada ou inativa'];
    }
    if (i.unitId && !(await tx.unit.findUnique({ where: { id: i.unitId }, select: { id: true } }))) fields.unitId = ['Unidade não encontrada'];
    if (i.preferredCarrierId && !(await tx.partnerRoleAssignment.findFirst({ where: { partnerId: i.preferredCarrierId, role: 'CARRIER' } }))) {
      fields.preferredCarrierId = ['Parceiro não é transportadora'];
    }
    if (Object.keys(fields).length) throw AppError.domain(ErrorCode.INCONSISTENT_RELATION, 'Verifique os dados da solicitação.', { fields });
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
      // Rascunho e solicitação em análise não têm versão publicada para visualizar.
      if (order.status === 'DRAFT' || order.status === 'PENDING_BILLING') return { recorded: false, version: null };
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
          context:
            scopeName === 'MATRIZ'
              ? ((e.after as Record<string, unknown>) ?? null)
              : {
                  ...pickPublicContext(e.after),
                  // O Comprador precisa saber por que a solicitação voltou ou foi cancelada.
                  ...(REASON_VISIBLE_TO_BUYER.has(e.action) ? { reason: ((e.after as Record<string, unknown> | null)?.reason as string | undefined) ?? null } : {}),
                },
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
    const internal = auth.membership!.scope === 'MATRIZ';
    let workflow: OrderDetail['workflow'] = null;
    if (internal) {
      const o = await tx.loadingOrder.findUniqueOrThrow({ where: { id } });
      const fe = await this.fourEyes(tx, o, auth.userId);
      const requester = o.publishRequestedBy ? await this.userNames(tx, [o.publishRequestedBy]) : new Map<string, string>();
      workflow = {
        publishRequestedAt: o.publishRequestedAt?.toISOString() ?? null,
        publishRequestedBy: o.publishRequestedBy ? (requester.get(o.publishRequestedBy) ?? null) : null,
        fourEyesRequired: fe.required,
        blockedByFourEyes: status === 'DRAFT' && fe.blocked,
      };
    }
    if (perms.has('order.update') && !['COMPLETED', 'CANCELLED'].includes(status)) actions.push('update');
    if (perms.has('order.publish') && status === 'DRAFT' && row.origin !== 'BUYER' && !workflow?.blockedByFourEyes) actions.push('publish');
    if (
      internal &&
      status === 'DRAFT' &&
      row.origin !== 'BUYER' &&
      (perms.has('order.create') || perms.has('order.update')) &&
      (!perms.has('order.publish') || workflow?.blockedByFourEyes)
    ) {
      actions.push('request_publish');
    }
    if (perms.has('order.release') && ['PUBLISHED', 'IN_PROGRESS'].includes(status)) actions.push('release');
    if (internal && status === 'PENDING_BILLING' && perms.has('order.billing.manage')) {
      actions.push('assign_farm', 'return_to_buyer');
      if (row.farm_id && row.seller_partner_id) actions.push('billing_publish');
    }
    if (auth.membership!.scope === 'BUYER' && row.origin === 'BUYER' && status === 'DRAFT' && row.created_by === auth.userId && perms.has('order.submit')) {
      actions.push('buyer_edit', 'submit');
    }
    if (
      auth.membership!.scope === 'BUYER' &&
      row.origin === 'BUYER' &&
      row.created_by === auth.userId &&
      perms.has('order.submit') &&
      (status === 'DRAFT' || (status === 'PENDING_BILLING' && !row.farm_id && !row.seller_partner_id))
    ) {
      actions.push('buyer_cancel');
    }
    if (internal && ['PUBLISHED', 'IN_PROGRESS'].includes(status) && perms.has('order.cancel')) actions.push('complete');
    if (perms.has('order.release') && ACTIVE_STATUSES.includes(status) && auth.membership!.scope === 'MATRIZ') actions.push('cancel_release');
    if (internal && perms.has('order.cancel')) {
      if (status === 'PUBLISHED' || status === 'IN_PROGRESS') actions.push('suspend');
      if (status === 'SUSPENDED') actions.push('resume');
      if (ACTIVE_STATUSES.includes(status) || status === 'PENDING_BILLING' || (status === 'DRAFT' && row.origin !== 'BUYER')) actions.push('cancel');
    }

    return { ...toDetail(row, releaseDtos, auth.membership!.scope, actions), workflow };
  }

  /**
   * Dupla checagem (Q40): vale se a empresa ativou e a ordem atinge a quantidade mínima (t).
   * Bloqueia quem fez a última alteração (ou criou, se nunca foi alterada).
   */
  private async fourEyes(tx: Tx, order: OrderRecord, userId: string): Promise<{ required: boolean; blocked: boolean }> {
    const tenant = await tx.tenant.findUnique({ where: { id: order.tenantId }, select: { publishFourEyes: true, publishFourEyesMinT: true } });
    if (!tenant?.publishFourEyes) return { required: false, blocked: false };
    let required = true;
    if (tenant.publishFourEyesMinT) {
      const unit = order.unitId ? await tx.unit.findUnique({ where: { id: order.unitId }, select: { factorToKg: true } }) : null;
      const tons = new Prisma.Decimal(order.quantity ?? 0).times(unit?.factorToKg ?? 1000).dividedBy(1000);
      required = tons.greaterThanOrEqualTo(tenant.publishFourEyesMinT);
    }
    const lastEditor = order.updatedBy ?? order.createdBy;
    return { required, blocked: required && lastEditor === userId };
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
