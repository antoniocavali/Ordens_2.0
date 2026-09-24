import {
  LOAD_STATUS_LABELS,
  OCCURRENCE_SEVERITY_LABELS,
  OCCURRENCE_STATUS_LABELS,
  OCCURRENCE_TYPE_LABELS,
  ORDER_STATUS_LABELS,
  RELEASE_STATUS_LABELS,
  type ReportColumn,
  type ReportKind,
} from '@ordens/contracts';
import { Prisma } from '@ordens/db';

export const TZ = 'America/Sao_Paulo';

export interface ReportParams {
  from: string;
  to: string;
  commodityId?: string;
  limit: number;
}

export interface ReportDefinition {
  /**
   * Chave da coluna = alias no SELECT. `labels` traduz códigos de enum. `hiddenFor`: perfis que não
   * recebem a coluna (mesmas regras de visibilidade da tela da ordem — ex.: Comprador não vê preço).
   */
  columns: (ReportColumn & { labels?: Record<string, string>; hiddenFor?: readonly ('FARM' | 'BUYER')[] })[];
  sql: (p: ReportParams) => Prisma.Sql;
}

const start = (p: ReportParams) => Prisma.sql`((${p.from}::date)::timestamp at time zone ${TZ})`;
const end = (p: ReportParams) => Prisma.sql`((${p.to}::date + 1)::timestamp at time zone ${TZ})`;
const commodity = (p: ReportParams, alias = 'lo') =>
  p.commodityId ? Prisma.sql`and ${Prisma.raw(alias)}.commodity_id = ${p.commodityId}::uuid` : Prisma.empty;
const partner = (alias: string) => Prisma.sql`coalesce(${Prisma.raw(alias)}.trade_name, ${Prisma.raw(alias)}.legal_name)`;
const unit = Prisma.sql`case when u.code = 'T' then 't' else lower(u.code) end`;

export const REPORTS: Record<ReportKind, ReportDefinition> = {
  orders: {
    columns: [
      { key: 'number', label: 'Ordem', type: 'text' },
      { key: 'status', label: 'Status', type: 'text', labels: ORDER_STATUS_LABELS },
      { key: 'published_at', label: 'Publicada em', type: 'datetime' },
      { key: 'commodity', label: 'Commodity', type: 'text' },
      { key: 'seller', label: 'Vendedor', type: 'text' },
      { key: 'farm', label: 'Fazenda', type: 'text' },
      { key: 'buyer', label: 'Comprador', type: 'text' },
      { key: 'contract', label: 'Contrato', type: 'text' },
      { key: 'unit', label: 'Unidade', type: 'text' },
      { key: 'quantity', label: 'Quantidade', type: 'qty' },
      { key: 'released', label: 'Liberado', type: 'qty' },
      { key: 'scheduled', label: 'Agendado', type: 'qty' },
      { key: 'loaded', label: 'Carregado', type: 'qty' },
      { key: 'in_transit', label: 'Em trânsito', type: 'qty' },
      { key: 'received', label: 'Recebido', type: 'qty' },
      { key: 'cancelled', label: 'Cancelado', type: 'qty' },
      { key: 'balance', label: 'Saldo a carregar', type: 'qty' },
      { key: 'unit_price', label: 'Preço unitário', type: 'money', hiddenFor: ['BUYER'] },
      { key: 'total_value', label: 'Valor estimado', type: 'money', hiddenFor: ['BUYER'] },
      { key: 'currency', label: 'Moeda', type: 'text', hiddenFor: ['BUYER'] },
    ],
    sql: (p) => Prisma.sql`
      select lo.number, lo.status::text as status, lo.published_at, c.name as commodity,
        ${partner('sp')} as seller, f.name as farm, ${partner('bp')} as buyer, ct.number as contract, ${unit} as unit,
        lo.quantity, lo.released_qty as released, lo.scheduled_qty as scheduled, lo.loaded_qty as loaded,
        lo.in_transit_qty as in_transit, lo.received_qty as received, lo.cancelled_qty as cancelled,
        greatest(coalesce(lo.quantity, 0) - lo.loaded_qty - lo.cancelled_qty, 0) as balance,
        lo.unit_price, round(lo.quantity * lo.unit_price, 2) as total_value, lo.currency,
        count(*) over () as total_count
      from loading_orders lo
      left join commodities c on c.id = lo.commodity_id
      left join business_partners sp on sp.id = lo.seller_partner_id
      left join business_partners bp on bp.id = lo.buyer_partner_id
      left join farms f on f.id = lo.farm_id
      left join contracts ct on ct.id = lo.contract_id
      left join units u on u.id = lo.unit_id
      -- Só ordens que chegaram à publicação (fora rascunhos, solicitações em análise e canceladas antes de publicar).
      where lo.status not in ('DRAFT', 'PENDING_BILLING')
        and not (lo.status = 'CANCELLED' and lo.origin = 'BUYER' and lo.published_at is null)
        and coalesce(lo.published_at, lo.created_at) >= ${start(p)} and coalesce(lo.published_at, lo.created_at) < ${end(p)}
        ${commodity(p)}
      order by coalesce(lo.published_at, lo.created_at) desc, lo.number desc
      limit ${p.limit}`,
  },

  requests: {
    columns: [
      { key: 'number', label: 'Solicitação', type: 'text' },
      { key: 'status', label: 'Status', type: 'text', labels: ORDER_STATUS_LABELS },
      { key: 'buyer', label: 'Comprador', type: 'text' },
      { key: 'requested_by', label: 'Criada por', type: 'text' },
      { key: 'commodity', label: 'Commodity', type: 'text' },
      { key: 'unit', label: 'Unidade', type: 'text' },
      { key: 'quantity', label: 'Quantidade', type: 'qty' },
      { key: 'submitted_at', label: 'Enviada em', type: 'datetime' },
      { key: 'farm', label: 'Fazenda definida', type: 'text' },
      { key: 'published_at', label: 'Publicada em', type: 'datetime' },
      { key: 'hours_to_publish', label: 'Horas até publicar', type: 'number' },
      { key: 'returned_at', label: 'Última devolução', type: 'datetime' },
      { key: 'return_reason', label: 'Motivo da devolução', type: 'text' },
      { key: 'cancelled_at', label: 'Cancelada em', type: 'datetime' },
      { key: 'cancel_reason', label: 'Motivo do cancelamento', type: 'text' },
    ],
    sql: (p) => Prisma.sql`
      select lo.number, lo.status::text as status, ${partner('bp')} as buyer, cu.name as requested_by, c.name as commodity,
        ${unit} as unit, lo.quantity, lo.submitted_at, f.name as farm, lo.published_at,
        case when lo.published_at is not null and lo.submitted_at is not null
          then round(extract(epoch from (lo.published_at - lo.submitted_at)) / 3600.0, 1) end as hours_to_publish,
        lo.returned_at, lo.return_reason, lo.cancelled_at, lo.cancel_reason,
        count(*) over () as total_count
      from loading_orders lo
      left join business_partners bp on bp.id = lo.buyer_partner_id
      left join users cu on cu.id = lo.created_by
      left join commodities c on c.id = lo.commodity_id
      left join farms f on f.id = lo.farm_id
      left join units u on u.id = lo.unit_id
      where lo.origin = 'BUYER' and lo.created_at >= ${start(p)} and lo.created_at < ${end(p)} ${commodity(p)}
      order by lo.created_at desc, lo.number desc
      limit ${p.limit}`,
  },

  loads: {
    columns: [
      { key: 'number', label: 'Carga', type: 'text' },
      { key: 'order_number', label: 'Ordem', type: 'text' },
      { key: 'status', label: 'Status', type: 'text', labels: LOAD_STATUS_LABELS },
      { key: 'loading_date', label: 'Data de carregamento', type: 'date' },
      { key: 'commodity', label: 'Commodity', type: 'text' },
      { key: 'farm', label: 'Fazenda', type: 'text' },
      { key: 'buyer', label: 'Comprador', type: 'text' },
      { key: 'carrier', label: 'Transportadora', type: 'text' },
      { key: 'driver', label: 'Motorista', type: 'text' },
      { key: 'plates', label: 'Placas', type: 'text' },
      { key: 'unit', label: 'Unidade', type: 'text' },
      { key: 'expected_qty', label: 'Previsto', type: 'qty' },
      { key: 'net_kg', label: 'Peso líquido (kg)', type: 'qty' },
      { key: 'received_qty', label: 'Recebido', type: 'qty' },
      { key: 'loaded_at', label: 'Carregada em', type: 'datetime' },
      { key: 'received_at', label: 'Recebida em', type: 'datetime' },
    ],
    sql: (p) => Prisma.sql`
      select l.number, lo.number as order_number, l.status::text as status, l.loading_date, c.name as commodity,
        f.name as farm, ${partner('bp')} as buyer, l.carrier_name as carrier, l.driver_name as driver, array_to_string(l.plates, ' ') as plates,
        ${unit} as unit, l.expected_qty, l.net_kg, l.received_qty, l.loaded_at, l.received_at,
        count(*) over () as total_count
      from loads l
      join loading_orders lo on lo.id = l.order_id
      left join commodities c on c.id = lo.commodity_id
      left join farms f on f.id = lo.farm_id
      left join business_partners bp on bp.id = lo.buyer_partner_id
      left join units u on u.id = lo.unit_id
      where coalesce(l.loading_date, (l.created_at at time zone ${TZ})::date) between ${p.from}::date and ${p.to}::date
        ${commodity(p)}
      order by coalesce(l.loading_date, (l.created_at at time zone ${TZ})::date) desc, l.number desc
      limit ${p.limit}`,
  },

  releases: {
    columns: [
      { key: 'order_number', label: 'Ordem', type: 'text' },
      { key: 'sequence', label: 'Liberação', type: 'number' },
      { key: 'status', label: 'Status', type: 'text', labels: RELEASE_STATUS_LABELS },
      { key: 'unit', label: 'Unidade', type: 'text' },
      { key: 'quantity', label: 'Quantidade', type: 'qty' },
      { key: 'valid_until', label: 'Validade', type: 'date' },
      { key: 'created_at', label: 'Criada em', type: 'datetime' },
      { key: 'created_by', label: 'Criada por', type: 'text', hiddenFor: ['FARM', 'BUYER'] },
      { key: 'cancelled_at', label: 'Cancelada em', type: 'datetime' },
      { key: 'cancelled_by', label: 'Cancelada por', type: 'text', hiddenFor: ['FARM', 'BUYER'] },
      { key: 'cancel_reason', label: 'Motivo do cancelamento', type: 'text' },
      { key: 'notes', label: 'Observação', type: 'text' },
    ],
    sql: (p) => Prisma.sql`
      select lo.number as order_number, r.sequence, r.status::text as status, ${unit} as unit, r.quantity, r.valid_until,
        r.created_at, cu.name as created_by, r.cancelled_at, xu.name as cancelled_by, r.cancel_reason, r.notes,
        count(*) over () as total_count
      from loading_order_releases r
      join loading_orders lo on lo.id = r.order_id
      left join units u on u.id = lo.unit_id
      left join users cu on cu.id = r.created_by
      left join users xu on xu.id = r.cancelled_by
      where r.created_at >= ${start(p)} and r.created_at < ${end(p)} ${commodity(p)}
      order by r.created_at desc
      limit ${p.limit}`,
  },

  carriers: {
    columns: [
      { key: 'carrier', label: 'Transportadora', type: 'text' },
      { key: 'loads', label: 'Cargas', type: 'number' },
      { key: 'net_t', label: 'Volume líquido (t)', type: 'qty' },
      { key: 'divergent', label: 'Cargas com divergência de peso', type: 'number' },
      { key: 'divergent_pct', label: '% com divergência', type: 'percent' },
    ],
    // Mesma regra de divergência do painel (Q24): recebido × líquido acima da tolerância (mínimo 0,5%).
    sql: (p) => Prisma.sql`
      select l.carrier_name as carrier, count(*) as loads,
        round(coalesce(sum(l.net_kg), 0) / 1000.0, 3) as net_t,
        count(*) filter (where d.divergent) as divergent,
        round(100.0 * count(*) filter (where d.divergent) / count(*), 1) as divergent_pct,
        count(*) over () as total_count
      from loads l
      join loading_orders lo on lo.id = l.order_id
      left join units u on u.id = lo.unit_id
      cross join lateral (select (l.received_qty is not null and l.net_kg > 0
        and abs(l.received_qty * coalesce(u.factor_to_kg, 1000) - l.net_kg) > l.net_kg * greatest(lo.tolerance_pct, 0.5) / 100) as divergent) d
      where l.status <> 'CANCELLED' and l.carrier_name is not null
        and l.created_at >= ${start(p)} and l.created_at < ${end(p)} ${commodity(p)}
      group by l.carrier_name
      order by loads desc, carrier
      limit ${p.limit}`,
  },

  occurrences: {
    columns: [
      { key: 'number', label: 'Ocorrência', type: 'text' },
      { key: 'order_number', label: 'Ordem', type: 'text' },
      { key: 'load_number', label: 'Carga', type: 'text' },
      { key: 'type', label: 'Tipo', type: 'text', labels: OCCURRENCE_TYPE_LABELS },
      { key: 'severity', label: 'Gravidade', type: 'text', labels: OCCURRENCE_SEVERITY_LABELS },
      { key: 'status', label: 'Status', type: 'text', labels: OCCURRENCE_STATUS_LABELS },
      { key: 'title', label: 'Título', type: 'text' },
      { key: 'responsible', label: 'Responsável', type: 'text' },
      { key: 'due_on', label: 'Prazo', type: 'date' },
      { key: 'overdue', label: 'Prazo vencido', type: 'text' },
      { key: 'created_at', label: 'Aberta em', type: 'datetime' },
      { key: 'resolved_at', label: 'Resolvida em', type: 'datetime' },
    ],
    sql: (p) => Prisma.sql`
      select oc.number, lo.number as order_number, l.number as load_number, oc.type::text as type, oc.severity::text as severity,
        oc.status::text as status, oc.title, ru.name as responsible, oc.due_on,
        (oc.status in ('OPEN', 'IN_PROGRESS') and oc.due_on < (now() at time zone ${TZ})::date) as overdue,
        oc.created_at, oc.resolved_at,
        count(*) over () as total_count
      from occurrences oc
      join loading_orders lo on lo.id = oc.order_id
      left join loads l on l.id = oc.load_id
      left join users ru on ru.id = oc.responsible_user_id
      where oc.created_at >= ${start(p)} and oc.created_at < ${end(p)} ${commodity(p)}
      order by oc.created_at desc
      limit ${p.limit}`,
  },
};
