import { Injectable } from '@nestjs/common';
import {
  contractInputSchema,
  ErrorCode,
  type ContractDetail,
  type ContractListItem,
  type ContractStatus,
  type Page,
  type RegistryListQuery,
} from '@ordens/contracts';
import { nextSequence, Prisma, type Tx } from '@ordens/db';
import type { z } from 'zod';
import { AppError } from '../../common/errors.js';
import { currentAuth } from '../../common/request-context.js';
import { TenantDb } from '../../infra/tenant-db.service.js';
import { fromDate, likePattern, toDate } from '../registry/registry.util.js';

type ContractData = z.output<typeof contractInputSchema>;

interface ContractRow {
  id: string;
  number: string;
  status: ContractStatus;
  seller_id: string;
  seller_name: string;
  buyer_id: string;
  buyer_name: string;
  commodity_id: string;
  commodity_name: string;
  crop_year: string | null;
  unit_id: string;
  unit_code: string;
  quantity: Prisma.Decimal;
  unit_price: Prisma.Decimal | null;
  currency: string;
  total_value: Prisma.Decimal | null;
  freight_mode: ContractListItem['freightMode'];
  starts_on: Date | null;
  ends_on: Date | null;
  terms: string | null;
  notes: string | null;
  orders_count: bigint;
  committed: Prisma.Decimal;
  released: Prisma.Decimal;
  loaded: Prisma.Decimal;
  received: Prisma.Decimal;
  created_at: Date;
  updated_at: Date;
  total: bigint;
}

const ACTIVE_ORDER = Prisma.sql`lo.contract_id = ct.id and lo.status not in ('DRAFT', 'CANCELLED')`;

function listSql(where: Prisma.Sql, limit: number, offset: number) {
  return Prisma.sql`
    select ct.id, ct.number, ct.status::text as status,
      s.id as seller_id, coalesce(s.trade_name, s.legal_name) as seller_name,
      b.id as buyer_id, coalesce(b.trade_name, b.legal_name) as buyer_name,
      c.id as commodity_id, c.name as commodity_name, ct.crop_year, u.id as unit_id, u.code as unit_code,
      ct.quantity, ct.unit_price, ct.currency, ct.total_value, ct.freight_mode::text as freight_mode,
      ct.starts_on, ct.ends_on, ct.terms, ct.notes,
      (select count(*) from loading_orders lo where lo.contract_id = ct.id and lo.status <> 'CANCELLED') as orders_count,
      (select coalesce(sum(lo.quantity), 0) from loading_orders lo where ${ACTIVE_ORDER}) as committed,
      (select coalesce(sum(lo.released_qty), 0) from loading_orders lo where ${ACTIVE_ORDER}) as released,
      (select coalesce(sum(lo.loaded_qty), 0) from loading_orders lo where ${ACTIVE_ORDER}) as loaded,
      (select coalesce(sum(lo.received_qty), 0) from loading_orders lo where ${ACTIVE_ORDER}) as received,
      ct.created_at, ct.updated_at, count(*) over () as total
    from contracts ct
    join business_partners s on s.id = ct.seller_partner_id
    join business_partners b on b.id = ct.buyer_partner_id
    join commodities c on c.id = ct.commodity_id
    join units u on u.id = ct.unit_id
    where ${where}
    order by ct.number desc, ct.id
    limit ${limit} offset ${offset}
  `;
}

function toItem(r: ContractRow): ContractListItem {
  const D = Prisma.Decimal;
  const contracted = new D(r.quantity);
  const committed = new D(r.committed);
  const price = r.unit_price ? new D(r.unit_price) : null;
  const totalValue = r.total_value ? new D(r.total_value) : price ? contracted.times(price).toDecimalPlaces(2) : null;
  const committedValue = price ? committed.times(price).toDecimalPlaces(2) : null;
  return {
    id: r.id,
    number: r.number,
    status: r.status,
    seller: { id: r.seller_id, name: r.seller_name },
    buyer: { id: r.buyer_id, name: r.buyer_name },
    commodity: { id: r.commodity_id, name: r.commodity_name },
    cropYear: r.crop_year,
    unit: { id: r.unit_id, code: r.unit_code },
    unitPrice: price?.toString() ?? null,
    currency: r.currency,
    freightMode: r.freight_mode,
    startsOn: fromDate(r.starts_on),
    endsOn: fromDate(r.ends_on),
    ordersCount: Number(r.orders_count),
    balances: {
      contracted: contracted.toString(),
      committed: committed.toString(),
      released: new D(r.released).toString(),
      loaded: new D(r.loaded).toString(),
      received: new D(r.received).toString(),
      balance: contracted.minus(committed).toString(),
      totalValue: totalValue?.toFixed(2) ?? null,
      committedValue: committedValue?.toFixed(2) ?? null,
      valueBalance: totalValue && committedValue ? totalValue.minus(committedValue).toFixed(2) : null,
    },
    updatedAt: r.updated_at.toISOString(),
  };
}

@Injectable()
export class ContractsService {
  constructor(private readonly db: TenantDb) {}

  list(q: RegistryListQuery & { contractStatus?: ContractStatus }): Promise<Page<ContractListItem>> {
    const conds: Prisma.Sql[] = [Prisma.sql`true`];
    if (q.contractStatus) conds.push(Prisma.sql`ct.status = ${q.contractStatus}::contract_status`);
    if (q.partnerId) conds.push(Prisma.sql`(ct.seller_partner_id = ${q.partnerId}::uuid or ct.buyer_partner_id = ${q.partnerId}::uuid)`);
    if (q.q) {
      const p = likePattern(q.q);
      conds.push(Prisma.sql`(ct.number ilike ${p} or s.legal_name ilike ${p} or s.trade_name ilike ${p} or b.legal_name ilike ${p} or b.trade_name ilike ${p} or c.name ilike ${p} or ct.crop_year ilike ${p})`);
    }
    return this.db.read(async (tx) => {
      const rows = await tx.$queryRaw<ContractRow[]>(listSql(Prisma.join(conds, ' and '), q.pageSize, (q.page - 1) * q.pageSize));
      return { items: rows.map(toItem), total: Number(rows[0]?.total ?? 0), page: q.page, pageSize: q.pageSize };
    });
  }

  detail(id: string): Promise<ContractDetail> {
    return this.db.read((tx) => this.loadDetail(tx, id));
  }

  create(input: ContractData): Promise<ContractDetail> {
    const tenantId = currentAuth().membership!.tenantId;
    return this.db.write(async ({ tx, audit }) => {
      await this.validateParties(tx, input);
      const number = input.number ?? (await this.nextNumber(tx, tenantId));
      await this.assertNumberFree(tx, number, null);
      const contract = await tx.contract.create({ data: { tenantId, number, ...this.contractData(input) } });
      await audit({ entityType: 'contract', entityId: contract.id, action: 'contract.created', after: { number, ...input } });
      return this.loadDetail(tx, contract.id);
    });
  }

  update(id: string, input: ContractData): Promise<ContractDetail> {
    return this.db.write(async ({ tx, audit }) => {
      const before = await tx.contract.findUnique({ where: { id } });
      if (!before) throw AppError.notFound('Contrato não encontrado.');
      await this.validateParties(tx, input);
      const number = input.number ?? before.number;
      await this.assertNumberFree(tx, number, id);

      const orders = await tx.loadingOrder.aggregate({
        where: { contractId: id, status: { notIn: ['DRAFT', 'CANCELLED'] } },
        _sum: { quantity: true },
        _count: true,
      });
      const anyOrders = await tx.loadingOrder.count({ where: { contractId: id } });
      if (anyOrders > 0) {
        const locked: Record<string, string[]> = {};
        if (before.sellerPartnerId !== input.sellerPartnerId) locked.sellerPartnerId = ['Travado: o contrato já possui ordens'];
        if (before.buyerPartnerId !== input.buyerPartnerId) locked.buyerPartnerId = ['Travado: o contrato já possui ordens'];
        if (before.commodityId !== input.commodityId) locked.commodityId = ['Travado: o contrato já possui ordens'];
        if (before.unitId !== input.unitId) locked.unitId = ['Travado: o contrato já possui ordens'];
        if (Object.keys(locked).length) {
          throw AppError.domain(ErrorCode.INCONSISTENT_RELATION, 'Partes, commodity e unidade não podem ser alteradas em contratos com ordens.', { fields: locked });
        }
      }
      const committed = new Prisma.Decimal(orders._sum.quantity ?? 0);
      if (new Prisma.Decimal(input.quantity).lessThan(committed)) {
        throw AppError.domain(ErrorCode.CONTRACT_BALANCE_EXCEEDED, `A quantidade não pode ser menor que o já comprometido em ordens (${committed.toString()}).`, {
          fields: { quantity: [`Mínimo: ${committed.toString()}`] },
        });
      }

      await tx.contract.update({ where: { id }, data: { number, ...this.contractData(input) } });
      await audit({
        entityType: 'contract',
        entityId: id,
        action: 'contract.updated',
        before: { number: before.number, quantity: before.quantity.toString(), unitPrice: before.unitPrice?.toString() ?? null, status: before.status, endsOn: fromDate(before.endsOn) },
        after: { number, quantity: input.quantity, unitPrice: input.unitPrice ?? null, status: input.status, endsOn: input.endsOn ?? null },
      });
      return this.loadDetail(tx, id);
    });
  }

  private contractData(i: ContractData) {
    const total = i.unitPrice ? new Prisma.Decimal(i.quantity).times(i.unitPrice).toDecimalPlaces(2) : null;
    return {
      sellerPartnerId: i.sellerPartnerId,
      buyerPartnerId: i.buyerPartnerId,
      commodityId: i.commodityId,
      cropYear: i.cropYear ?? null,
      quantity: i.quantity,
      unitId: i.unitId,
      unitPrice: i.unitPrice ?? null,
      currency: i.currency,
      totalValue: total,
      startsOn: toDate(i.startsOn),
      endsOn: toDate(i.endsOn),
      freightMode: i.freightMode ?? null,
      terms: i.terms ?? null,
      notes: i.notes ?? null,
      status: i.status,
    };
  }

  private async validateParties(tx: Tx, i: ContractData) {
    const roles = await tx.partnerRoleAssignment.findMany({ where: { partnerId: { in: [i.sellerPartnerId, i.buyerPartnerId] } } });
    const fields: Record<string, string[]> = {};
    if (!roles.some((r) => r.partnerId === i.sellerPartnerId && ['SELLER', 'PRODUCER', 'COOPERATIVE_MEMBER', 'COOPERATIVE'].includes(r.role))) {
      fields.sellerPartnerId = ['Parceiro não é vendedor'];
    }
    if (!roles.some((r) => r.partnerId === i.buyerPartnerId && r.role === 'BUYER')) fields.buyerPartnerId = ['Parceiro não é comprador'];
    const [commodity, unit] = await Promise.all([tx.commodity.findUnique({ where: { id: i.commodityId } }), tx.unit.findUnique({ where: { id: i.unitId } })]);
    if (!commodity) fields.commodityId = ['Commodity não encontrada'];
    if (!unit) fields.unitId = ['Unidade não encontrada'];
    if (Object.keys(fields).length) throw AppError.domain(ErrorCode.INCONSISTENT_RELATION, 'Há dados incompatíveis no contrato.', { fields });
  }

  private async nextNumber(tx: Tx, tenantId: string) {
    const year = new Date().getUTCFullYear();
    const seq = await nextSequence(tx, tenantId, 'contract', year);
    return `CT-${year}-${String(seq).padStart(4, '0')}`;
  }

  private async assertNumberFree(tx: Tx, number: string, exceptId: string | null) {
    const dup = await tx.contract.findFirst({ where: { number, ...(exceptId ? { id: { not: exceptId } } : {}) } });
    if (dup) throw AppError.conflict(`Já existe o contrato ${number}.`, ErrorCode.CONFLICT, { fields: { number: ['Número em uso'] } });
  }

  private async loadDetail(tx: Tx, id: string): Promise<ContractDetail> {
    const [row] = await tx.$queryRaw<ContractRow[]>(listSql(Prisma.sql`ct.id = ${id}::uuid`, 1, 0));
    if (!row) throw AppError.notFound('Contrato não encontrado.');
    const orders = await tx.loadingOrder.findMany({
      where: { contractId: id },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: { id: true, number: true, status: true, quantity: true, loadedQty: true, createdAt: true },
    });
    return {
      ...toItem(row),
      terms: row.terms,
      notes: row.notes,
      orders: orders.map((o) => ({ id: o.id, number: o.number, status: o.status, quantity: o.quantity?.toString() ?? null, loaded: o.loadedQty.toString(), createdAt: o.createdAt.toISOString() })),
      createdAt: row.created_at.toISOString(),
    };
  }
}
