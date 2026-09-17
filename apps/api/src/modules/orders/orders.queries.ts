import type { OrderListQuery } from '@ordens/contracts';
import { Prisma } from '@ordens/db';

export interface OrderRow {
  id: string;
  number: string;
  external_number: string | null;
  order_date: Date | null;
  status: string;
  priority: string;
  operation_type: string | null;
  version: number;
  contract_id: string | null;
  contract_number: string | null;
  seller_partner_id: string | null;
  seller_name: string | null;
  farm_id: string | null;
  farm_name: string | null;
  farm_city: string | null;
  farm_state: string | null;
  buyer_partner_id: string | null;
  buyer_name: string | null;
  commodity_id: string | null;
  commodity_name: string | null;
  crop_year: string | null;
  quantity: Prisma.Decimal | null;
  unit_id: string | null;
  unit_code: string | null;
  unit_name: string | null;
  released_qty: Prisma.Decimal;
  scheduled_qty: Prisma.Decimal;
  loaded_qty: Prisma.Decimal;
  in_transit_qty: Prisma.Decimal;
  received_qty: Prisma.Decimal;
  cancelled_qty: Prisma.Decimal;
  initial_release_qty: Prisma.Decimal | null;
  unit_price: Prisma.Decimal | null;
  currency: string;
  freight_mode: string | null;
  freight_estimate: Prisma.Decimal | null;
  preferred_carrier_id: string | null;
  carrier_name: string | null;
  loading_starts_on: Date | null;
  loading_ends_on: Date | null;
  tolerance_pct: Prisma.Decimal;
  destination_name: string | null;
  destination_address: string | null;
  destination_city: string | null;
  destination_state: string | null;
  commercial_terms: string | null;
  loading_instructions: string | null;
  internal_notes: string | null;
  farm_notes: string | null;
  buyer_notes: string | null;
  published_at: Date | null;
  created_at: Date;
  created_by_name: string | null;
  updated_at: Date;
  updated_by_name: string | null;
  seller_org_id: string | null;
  buyer_org_id: string | null;
  origin: string;
  created_by: string | null;
  submitted_at: Date | null;
  submitted_by_name: string | null;
  returned_at: Date | null;
  returned_by_name: string | null;
  return_reason: string | null;
  cancelled_at: Date | null;
  cancel_reason: string | null;
  farm_signal: string;
  farm_viewed_version: number | null;
  farm_viewed_at: Date | null;
  farm_viewed_by: string | null;
  buyer_signal: string;
  buyer_viewed_version: number | null;
  buyer_viewed_at: Date | null;
  buyer_viewed_by: string | null;
  total_count: bigint;
}

const SORT_COLUMNS: Record<string, string> = {
  number: 'number',
  orderDate: 'order_date',
  loadingStartsOn: 'loading_starts_on',
  quantity: 'quantity',
  updatedAt: 'updated_at',
};

function signalSql(side: 'FARM' | 'BUYER', slaHours: number): Prisma.Sql {
  const alias = side === 'FARM' ? Prisma.raw('fv') : Prisma.raw('bv');
  const orgCol = side === 'FARM' ? Prisma.raw('lo.seller_org_id') : Prisma.raw('lo.buyer_org_id');
  return Prisma.sql`
    case
      when lo.status = 'DRAFT' then 'NEVER'
      when ${orgCol} is null then 'NO_PORTAL'
      when ${alias}.version = lo.version then 'CURRENT'
      when now() - coalesce(lo.last_material_change_at, lo.published_at, lo.created_at) > make_interval(hours => ${slaHours}::int) then 'OVERDUE'
      when ${alias}.version is null then 'NEVER'
      else 'OUTDATED'
    end`;
}

/**
 * SQL base da central de Ordens: joins de nomes, último farol por lado (lateral) e contagem total.
 * Filtros, ordenação e paginação são server-side. Executar sempre dentro de TenantDb.read (RLS).
 */
export function orderSelectSql(opts: { slaHours: number; where: Prisma.Sql; orderBy: Prisma.Sql; limit: number; offset: number; outerWhere?: Prisma.Sql }) {
  return Prisma.sql`
    select o.*, count(*) over () as total_count from (
      select
        lo.id, lo.number, lo.external_number, lo.order_date, lo.status::text as status, lo.priority::text as priority,
        lo.operation_type::text as operation_type, lo.version,
        lo.contract_id, ct.number as contract_number,
        lo.seller_partner_id, coalesce(sp.trade_name, sp.legal_name) as seller_name,
        lo.farm_id, f.name as farm_name, f.city as farm_city, f.state as farm_state,
        lo.buyer_partner_id, coalesce(bp.trade_name, bp.legal_name) as buyer_name,
        lo.commodity_id, c.name as commodity_name, lo.crop_year,
        lo.quantity, lo.unit_id, u.code as unit_code, u.name as unit_name,
        lo.released_qty, lo.scheduled_qty, lo.loaded_qty, lo.in_transit_qty, lo.received_qty, lo.cancelled_qty,
        lo.initial_release_qty, lo.unit_price, lo.currency, lo.freight_mode::text as freight_mode, lo.freight_estimate,
        lo.preferred_carrier_id, coalesce(cr.trade_name, cr.legal_name) as carrier_name,
        lo.loading_starts_on, lo.loading_ends_on, lo.tolerance_pct,
        lo.destination_name, lo.destination_address, lo.destination_city, lo.destination_state,
        lo.commercial_terms, lo.loading_instructions, lo.internal_notes, lo.farm_notes, lo.buyer_notes,
        lo.published_at, lo.created_at, cu.name as created_by_name, lo.updated_at, uu.name as updated_by_name,
        lo.seller_org_id, lo.buyer_org_id,
        lo.origin::text as origin, lo.created_by, lo.submitted_at, su.name as submitted_by_name,
        lo.returned_at, ru.name as returned_by_name, lo.return_reason, lo.cancelled_at, lo.cancel_reason,
        ${signalSql('FARM', opts.slaHours)} as farm_signal,
        fv.version as farm_viewed_version, fv.last_viewed_at as farm_viewed_at, fvu.name as farm_viewed_by,
        ${signalSql('BUYER', opts.slaHours)} as buyer_signal,
        bv.version as buyer_viewed_version, bv.last_viewed_at as buyer_viewed_at, bvu.name as buyer_viewed_by
      from loading_orders lo
      left join contracts ct on ct.id = lo.contract_id
      left join business_partners sp on sp.id = lo.seller_partner_id
      left join business_partners bp on bp.id = lo.buyer_partner_id
      left join business_partners cr on cr.id = lo.preferred_carrier_id
      left join farms f on f.id = lo.farm_id
      left join commodities c on c.id = lo.commodity_id
      left join units u on u.id = lo.unit_id
      left join users cu on cu.id = lo.created_by
      left join users uu on uu.id = lo.updated_by
      left join users su on su.id = lo.submitted_by
      left join users ru on ru.id = lo.returned_by
      left join lateral (
        select v.version, v.last_viewed_at, v.user_id from loading_order_views v
        where v.order_id = lo.id and v.side = 'FARM'
        order by v.version desc, v.last_viewed_at desc limit 1
      ) fv on true
      left join users fvu on fvu.id = fv.user_id
      left join lateral (
        select v.version, v.last_viewed_at, v.user_id from loading_order_views v
        where v.order_id = lo.id and v.side = 'BUYER'
        order by v.version desc, v.last_viewed_at desc limit 1
      ) bv on true
      left join users bvu on bvu.id = bv.user_id
      where ${opts.where}
    ) o
    where ${opts.outerWhere ?? Prisma.sql`true`}
    order by ${opts.orderBy}
    limit ${opts.limit} offset ${opts.offset}
  `;
}

const SEARCH_JOINS = Prisma.sql`
  left join contracts ct on ct.id = lo.contract_id
  left join business_partners sp on sp.id = lo.seller_partner_id
  left join business_partners bp on bp.id = lo.buyer_partner_id
  left join farms f on f.id = lo.farm_id
  left join commodities c on c.id = lo.commodity_id`;

/**
 * Página de ids (com o total na mesma passada) sem faróis nem nomes: evita calcular laterais
 * para todas as ordens (paginação em duas etapas).
 */
export function orderIdsSql(f: { where: Prisma.Sql; innerOrderBy: Prisma.Sql; hasSearch: boolean; limit: number; offset: number }) {
  return Prisma.sql`
    select lo.id, count(*) over () as total_count from loading_orders lo ${f.hasSearch ? SEARCH_JOINS : Prisma.empty}
    where ${f.where}
    order by ${f.innerOrderBy}
    limit ${f.limit} offset ${f.offset}`;
}

export function orderCountSql(f: { where: Prisma.Sql; hasSearch: boolean }) {
  return Prisma.sql`select count(*) as total from loading_orders lo ${f.hasSearch ? SEARCH_JOINS : Prisma.empty} where ${f.where}`;
}

export function buildListFilters(q: OrderListQuery): {
  where: Prisma.Sql;
  outerWhere: Prisma.Sql;
  orderBy: Prisma.Sql;
  innerOrderBy: Prisma.Sql;
  /** Filtro por farol exige calcular os sinais de todas as linhas antes de paginar. */
  needsSignals: boolean;
  hasSearch: boolean;
} {
  const conds: Prisma.Sql[] = [Prisma.sql`true`];
  if (q.status?.length) conds.push(Prisma.sql`lo.status::text in (${Prisma.join(q.status)})`);
  if (q.priority) conds.push(Prisma.sql`lo.priority = ${q.priority}::order_priority`);
  if (q.commodityId) conds.push(Prisma.sql`lo.commodity_id = ${q.commodityId}::uuid`);
  if (q.sellerPartnerId) conds.push(Prisma.sql`lo.seller_partner_id = ${q.sellerPartnerId}::uuid`);
  if (q.buyerPartnerId) conds.push(Prisma.sql`lo.buyer_partner_id = ${q.buyerPartnerId}::uuid`);
  if (q.farmId) conds.push(Prisma.sql`lo.farm_id = ${q.farmId}::uuid`);
  if (q.contractId) conds.push(Prisma.sql`lo.contract_id = ${q.contractId}::uuid`);
  if (q.from) conds.push(Prisma.sql`lo.loading_ends_on >= ${q.from}::date`);
  if (q.to) conds.push(Prisma.sql`lo.loading_starts_on <= ${q.to}::date`);
  if (q.q) {
    const p = `%${q.q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    conds.push(Prisma.sql`(
      lo.number ilike ${p} or lo.external_number ilike ${p} or sp.legal_name ilike ${p} or sp.trade_name ilike ${p}
      or bp.legal_name ilike ${p} or bp.trade_name ilike ${p} or f.name ilike ${p} or ct.number ilike ${p} or c.name ilike ${p}
    )`);
  }

  const outer: Prisma.Sql[] = [Prisma.sql`true`];
  if (q.farmSignal) outer.push(Prisma.sql`o.farm_signal = ${q.farmSignal}`);
  if (q.buyerSignal) outer.push(Prisma.sql`o.buyer_signal = ${q.buyerSignal}`);

  const [field, dir] = q.sort.split(':') as [string, 'asc' | 'desc'];
  const column = SORT_COLUMNS[field] ?? 'updated_at';
  const direction = dir === 'asc' ? 'asc' : 'desc';
  const orderBy = Prisma.raw(`o.${column} ${direction} nulls last, o.id`);
  const innerOrderBy = Prisma.raw(`lo.${column} ${direction} nulls last, lo.id`);

  return {
    where: Prisma.join(conds, ' and '),
    outerWhere: Prisma.join(outer, ' and '),
    orderBy,
    innerOrderBy,
    needsSignals: Boolean(q.farmSignal || q.buyerSignal),
    hasSearch: Boolean(q.q),
  };
}
