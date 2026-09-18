import { Injectable } from '@nestjs/common';
import {
  MANAGEMENT_CYCLE_BUCKETS,
  type ManagementCycleDto,
  type ManagementOrderRow,
  type ManagementOrdersQuery,
  type OrderStatus,
  type Page,
  type ReportQuery,
} from '@ordens/contracts';
import { Prisma } from '@ordens/db';
import { AppError } from '../../common/errors.js';
import { currentAuth } from '../../common/request-context.js';
import { TenantDb } from '../../infra/tenant-db.service.js';

const TZ = 'America/Sao_Paulo';
type Dec = Prisma.Decimal | number | bigint | string | null | undefined;
const hours = (v: Dec) => (v === null || v === undefined ? null : Math.round(Number(v) * 10) / 10);
const int = (v: Dec) => Number(v ?? 0);
const tons = (v: Dec) => (v === null || v === undefined ? '0' : new Prisma.Decimal(v.toString()).toDecimalPlaces(3).toString());

/**
 * Painel de Gestão (Q46): tempo de ciclo das ordens concluídas no período e idade das ordens abertas.
 * As linhas continuam recortadas pelo RLS; o painel é da Matriz (`dashboard.matriz`).
 */
@Injectable()
export class ManagementService {
  constructor(private readonly db: TenantDb) {}

  cycle(q: ReportQuery & { from: string; to: string }): Promise<ManagementCycleDto> {
    const auth = currentAuth();
    if (auth.membership?.scope !== 'MATRIZ' || !auth.permissions.has('dashboard.matriz')) {
      throw AppError.forbidden('Painel de gestão disponível apenas para a Matriz.');
    }
    const start = Prisma.sql`((${q.from}::date)::timestamp at time zone ${TZ})`;
    const end = Prisma.sql`((${q.to}::date + 1)::timestamp at time zone ${TZ})`;
    const commodity = q.commodityId ? Prisma.sql`and lo.commodity_id = ${q.commodityId}::uuid` : Prisma.empty;

    return this.db.read(async (tx) => {
      // Uma passada pelas ordens concluídas no período, com os marcos de cada uma.
      const rows = await tx.$queryRaw<
        {
          id: string;
          number: string;
          commodity_id: string | null;
          commodity: string | null;
          counterpart: string | null;
          completed_at: Date;
          completion_reason: string | null;
          via: string;
          submit_to_publish: Dec;
          publish_to_first_load: Dec;
          publish_to_complete: Dec;
          first_load_to_complete: Dec;
          balance: Dec;
        }[]
      >(Prisma.sql`
        select lo.id, lo.number, lo.commodity_id, c.name as commodity,
          coalesce(bp.trade_name, bp.legal_name) as counterpart,
          lo.completed_at, lo.completion_reason, coalesce(lo.completion_via, 'auto') as via,
          extract(epoch from lo.published_at - lo.submitted_at) / 3600.0 as submit_to_publish,
          extract(epoch from fl.first_load - lo.published_at) / 3600.0 as publish_to_first_load,
          extract(epoch from lo.completed_at - lo.published_at) / 3600.0 as publish_to_complete,
          extract(epoch from lo.completed_at - fl.first_load) / 3600.0 as first_load_to_complete,
          greatest(coalesce(lo.quantity, 0) - lo.loaded_qty - lo.cancelled_qty, 0) as balance
        from loading_orders lo
        left join commodities c on c.id = lo.commodity_id
        left join business_partners bp on bp.id = lo.buyer_partner_id
        left join lateral (
          select min(l.created_at) as first_load from loads l where l.order_id = lo.id and l.status <> 'CANCELLED'
        ) fl on true
        where lo.status = 'COMPLETED' and lo.completed_at >= ${start} and lo.completed_at < ${end} ${commodity}
        order by publish_to_complete desc nulls last
      `);

      const aging = await tx.$queryRaw<{ days: Dec; n: Dec }[]>(Prisma.sql`
        select floor(extract(epoch from now() - coalesce(lo.published_at, lo.created_at)) / 86400.0) as days, count(*) as n
        from loading_orders lo
        where lo.status in ('PUBLISHED', 'IN_PROGRESS') ${commodity}
        group by 1
      `);

      const avg = (pick: (r: (typeof rows)[number]) => Dec) => {
        const values = rows.map(pick).map(Number).filter((v) => Number.isFinite(v));
        if (!values.length) return null;
        return hours(values.reduce((a, b) => a + b, 0) / values.length);
      };
      const cycles = rows.map((r) => Number(r.publish_to_complete)).filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
      const p90 = cycles.length ? hours(cycles[Math.min(cycles.length - 1, Math.floor(cycles.length * 0.9))]!) : null;

      const bucketOf = (days: number) => MANAGEMENT_CYCLE_BUCKETS.find((b) => b.maxDays === null || days <= b.maxDays)!;
      const histogram = MANAGEMENT_CYCLE_BUCKETS.map((b) => ({
        key: b.key,
        label: b.label,
        count: cycles.filter((h) => bucketOf(h / 24).key === b.key).length,
      }));
      const openAging = MANAGEMENT_CYCLE_BUCKETS.map((b) => ({
        key: b.key,
        label: b.label,
        count: aging.filter((a) => bucketOf(Number(a.days ?? 0)).key === b.key).reduce((acc, a) => acc + int(a.n), 0),
      }));

      const byCommodityMap = new Map<string, { id: string; name: string; values: number[] }>();
      for (const r of rows) {
        if (!r.commodity_id) continue;
        const entry = byCommodityMap.get(r.commodity_id) ?? { id: r.commodity_id, name: r.commodity ?? '—', values: [] };
        const v = Number(r.publish_to_complete);
        if (Number.isFinite(v)) entry.values.push(v);
        byCommodityMap.set(r.commodity_id, entry);
      }

      return {
        from: q.from,
        to: q.to,
        generatedAt: new Date().toISOString(),
        completed: rows.length,
        autoCompleted: rows.filter((r) => r.via === 'auto').length,
        completedWithBalance: rows.filter((r) => Number(r.balance ?? 0) > 0).length,
        averagesHours: {
          submitToPublish: avg((r) => r.submit_to_publish),
          publishToFirstLoad: avg((r) => r.publish_to_first_load),
          publishToComplete: avg((r) => r.publish_to_complete),
          firstLoadToComplete: avg((r) => r.first_load_to_complete),
        },
        p90PublishToComplete: p90,
        histogram,
        byCommodity: [...byCommodityMap.values()]
          .map((e) => ({ id: e.id, name: e.name, orders: e.values.length, avgHours: e.values.length ? hours(e.values.reduce((a, b) => a + b, 0) / e.values.length) : null }))
          .sort((a, b) => (b.avgHours ?? 0) - (a.avgHours ?? 0))
          .slice(0, 8),
        slowest: rows
          .filter((r) => Number.isFinite(Number(r.publish_to_complete)))
          .slice(0, 8)
          .map((r) => ({
            id: r.id,
            number: r.number,
            commodity: r.commodity,
            counterpart: r.counterpart,
            hours: hours(r.publish_to_complete)!,
            via: r.via,
            completedAt: r.completed_at.toISOString(),
          })),
        openAging,
      };
    });
  }

  /**
   * Listagem paginada do tempo por ordem: concluídas no período e/ou abertas, com busca por número,
   * commodity, fazenda e comprador. O total vem da mesma consulta (count over).
   */
  orders(q: ManagementOrdersQuery & { from: string; to: string }): Promise<Page<ManagementOrderRow>> {
    const auth = currentAuth();
    if (auth.membership?.scope !== 'MATRIZ' || !auth.permissions.has('dashboard.matriz')) {
      throw AppError.forbidden('Painel de gestão disponível apenas para a Matriz.');
    }
    const start = Prisma.sql`((${q.from}::date)::timestamp at time zone ${TZ})`;
    const end = Prisma.sql`((${q.to}::date + 1)::timestamp at time zone ${TZ})`;
    const commodity = q.commodityId ? Prisma.sql`and lo.commodity_id = ${q.commodityId}::uuid` : Prisma.empty;
    const completed = Prisma.sql`(lo.status = 'COMPLETED' and lo.completed_at >= ${start} and lo.completed_at < ${end})`;
    const open = Prisma.sql`lo.status in ('PUBLISHED', 'IN_PROGRESS')`;
    const situation = q.situation === 'completed' ? completed : q.situation === 'open' ? open : Prisma.sql`(${completed} or ${open})`;
    const search = q.q
      ? Prisma.sql`and (lo.number ilike ${'%' + q.q + '%'} or c.name ilike ${'%' + q.q + '%'} or f.name ilike ${'%' + q.q + '%'}
          or coalesce(bp.trade_name, bp.legal_name) ilike ${'%' + q.q + '%'})`
      : Prisma.empty;
    const order = {
      'cycle:desc': Prisma.sql`publish_to_end desc nulls last`,
      'cycle:asc': Prisma.sql`publish_to_end asc nulls last`,
      'completedAt:desc': Prisma.sql`lo.completed_at desc nulls last`,
      'number:asc': Prisma.sql`lo.number asc`,
    }[q.sort];

    return this.db.read(async (tx) => {
      const rows = await tx.$queryRaw<
        {
          id: string;
          number: string;
          commodity: string | null;
          farm: string | null;
          buyer: string | null;
          status: OrderStatus;
          via: string | null;
          submitted_at: Date | null;
          published_at: Date | null;
          first_load_at: Date | null;
          completed_at: Date | null;
          loads: Dec;
          quantity_t: Dec;
          loaded_t: Dec;
          submit_to_publish: Dec;
          publish_to_first_load: Dec;
          publish_to_end: Dec;
          total_count: Dec;
        }[]
      >(Prisma.sql`
        select lo.id, lo.number, c.name as commodity, f.name as farm,
          coalesce(bp.trade_name, bp.legal_name) as buyer, lo.status::text as status,
          case when lo.status = 'COMPLETED' then coalesce(lo.completion_via, 'auto') end as via,
          lo.submitted_at, lo.published_at, fl.first_load as first_load_at, lo.completed_at, fl.loads,
          lo.quantity * coalesce(u.factor_to_kg, 1000) / 1000.0 as quantity_t,
          lo.loaded_qty * coalesce(u.factor_to_kg, 1000) / 1000.0 as loaded_t,
          extract(epoch from lo.published_at - lo.submitted_at) / 3600.0 as submit_to_publish,
          extract(epoch from fl.first_load - lo.published_at) / 3600.0 as publish_to_first_load,
          extract(epoch from coalesce(lo.completed_at, now()) - lo.published_at) / 3600.0 as publish_to_end,
          count(*) over () as total_count
        from loading_orders lo
        left join commodities c on c.id = lo.commodity_id
        left join farms f on f.id = lo.farm_id
        left join business_partners bp on bp.id = lo.buyer_partner_id
        left join units u on u.id = lo.unit_id
        left join lateral (
          select min(l.created_at) as first_load, count(*) as loads
          from loads l where l.order_id = lo.id and l.status <> 'CANCELLED'
        ) fl on true
        where ${situation} ${commodity} ${search}
        order by ${order}
        limit ${q.pageSize} offset ${(q.page - 1) * q.pageSize}
      `);
      return {
        total: int(rows[0]?.total_count),
        page: q.page,
        pageSize: q.pageSize,
        items: rows.map(
          (o): ManagementOrderRow => ({
            id: o.id,
            number: o.number,
            commodity: o.commodity,
            farm: o.farm,
            buyer: o.buyer,
            status: o.status,
            via: o.via === 'manual' ? 'manual' : o.via === 'auto' ? 'auto' : null,
            submittedAt: o.submitted_at?.toISOString() ?? null,
            publishedAt: o.published_at?.toISOString() ?? null,
            firstLoadAt: o.first_load_at?.toISOString() ?? null,
            completedAt: o.completed_at?.toISOString() ?? null,
            loads: int(o.loads),
            quantityT: tons(o.quantity_t),
            loadedT: tons(o.loaded_t),
            hours: {
              submitToPublish: hours(o.submit_to_publish),
              publishToFirstLoad: hours(o.publish_to_first_load),
              publishToEnd: hours(o.publish_to_end),
            },
          }),
        ),
      };
    });
  }
}
