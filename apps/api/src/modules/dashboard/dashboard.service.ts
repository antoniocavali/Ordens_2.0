import { Injectable } from '@nestjs/common';
import { LOAD_STAGES, type AttentionItem, type AttentionTone, type DashboardDto, type DashboardQuery } from '@ordens/contracts';
import { Prisma } from '@ordens/db';
import { AppError } from '../../common/errors.js';
import { currentAuth } from '../../common/request-context.js';
import { TenantDb } from '../../infra/tenant-db.service.js';

const D = Prisma.Decimal;
/** Fuso operacional para "hoje" e séries diárias (Q21). */
const TZ = 'America/Sao_Paulo';
const ACTIVE = Prisma.sql`('PUBLISHED', 'IN_PROGRESS', 'SUSPENDED')`;

type Dec = Prisma.Decimal | number | bigint | string | null | undefined;
const int = (v: Dec) => Number(v ?? 0);
const tons = (v: Dec) => new D((v ?? 0).toString()).toDecimalPlaces(3).toString();

function shiftDay(day: string, delta: number) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

const item = (key: string, label: string, count: Dec, tone: AttentionTone, href: string): AttentionItem => ({ key, label, count: int(count), tone, href });

/**
 * Painéis por perfil. As mesmas consultas servem Matriz, Fazenda e Comprador:
 * o RLS recorta as linhas pela organização ativa; aqui só se escolhe o que exibir.
 */
@Injectable()
export class DashboardService {
  constructor(private readonly db: TenantDb) {}

  get(q: DashboardQuery): Promise<DashboardDto> {
    const auth = currentAuth();
    const m = auth.membership;
    const scope = m?.scope;
    const allowed =
      (scope === 'MATRIZ' && auth.permissions.has('dashboard.matriz')) ||
      (scope === 'FARM' && auth.permissions.has('dashboard.farm')) ||
      (scope === 'BUYER' && auth.permissions.has('dashboard.buyer'));
    if (!m || !scope || !allowed) throw AppError.forbidden('Painel indisponível para o seu perfil.');
    const isMatriz = scope === 'MATRIZ';

    return this.db.read(async (tx) => {
      const [clock] = await tx.$queryRaw<{ today: string }[]>(Prisma.sql`select to_char((now() at time zone ${TZ})::date, 'YYYY-MM-DD') as today`);
      const today = clock!.today;
      const days = q.period === '30d' ? 30 : 7;
      const seriesFrom = shiftDay(today, -(days - 1));
      const periodFrom = q.period === 'today' ? today : seriesFrom;
      const periodStart = Prisma.sql`((${periodFrom}::date)::timestamp at time zone ${TZ})`;
      const seriesStart = Prisma.sql`((${seriesFrom}::date)::timestamp at time zone ${TZ})`;
      const commodity = (alias: string) => (q.commodityId ? Prisma.sql`${Prisma.raw(alias)}.commodity_id = ${q.commodityId}::uuid` : Prisma.sql`true`);
      // Junta a ordem só com filtro de commodity: sem ele, evita uma verificação RLS de ordem por linha.
      const orderFilterJoin = (alias: string) =>
        q.commodityId ? Prisma.sql`join loading_orders lo on lo.id = ${Prisma.raw(alias)}.order_id and lo.commodity_id = ${q.commodityId}::uuid` : Prisma.empty;
      const ordersCte = Prisma.sql`
        with o as (
          select lo.*, coalesce(u.factor_to_kg, 1000) / 1000.0 as tf
          from loading_orders lo
          left join units u on u.id = lo.unit_id
          where ${commodity('lo')}
        )`;
      const sla = (await tx.tenant.findUnique({ where: { id: m.tenantId }, select: { viewSlaHours: true } }))?.viewSlaHours ?? 24;

      // ─── Volumes das ordens ───
      const [k] = await tx.$queryRaw<Record<string, Dec>[]>(Prisma.sql`
        ${ordersCte}
        select
          count(*) filter (where status in ${ACTIVE}) as open_orders,
          count(*) filter (where published_at >= ${periodStart}) as published_in_period,
          coalesce(sum(quantity * tf) filter (where status in ${ACTIVE}), 0) as ordered_t,
          coalesce(sum(released_qty * tf) filter (where status in ${ACTIVE}), 0) as released_t,
          coalesce(sum(scheduled_qty * tf) filter (where status in ${ACTIVE}), 0) as scheduled_t,
          coalesce(sum(loaded_qty * tf) filter (where status in ${ACTIVE}), 0) as loaded_t,
          coalesce(sum(in_transit_qty * tf) filter (where status in ${ACTIVE}), 0) as in_transit_t,
          coalesce(sum(received_qty * tf) filter (where status in ${ACTIVE}), 0) as received_t,
          coalesce(sum(cancelled_qty * tf) filter (where status in ${ACTIVE}), 0) as cancelled_t,
          coalesce(sum(loaded_qty * unit_price) filter (where status in ${ACTIVE} and currency = 'BRL'), 0) as loaded_value
        from o
      `);
      let contractedT: string | null = null;
      if (isMatriz) {
        const [c] = await tx.$queryRaw<{ t: Dec }[]>(Prisma.sql`
          select coalesce(sum(c.quantity * coalesce(u.factor_to_kg, 1000) / 1000.0), 0) as t
          from contracts c left join units u on u.id = c.unit_id
          where c.status = 'ACTIVE' and ${commodity('c')}
        `);
        contractedT = tons(c?.t);
      }

      // ─── Faróis e tolerância ───
      const [sig] = await tx.$queryRaw<Record<string, Dec>[]>(Prisma.sql`
        ${ordersCte}
        select
          count(*) filter (where o.status = 'DRAFT' and o.origin = 'MATRIZ') as drafts,
          count(*) filter (where o.status = 'PENDING_BILLING') as pending_billing,
          count(*) filter (where o.status = 'DRAFT' and o.origin = 'BUYER' and o.returned_at is not null) as buyer_returned,
          count(*) filter (where o.status in ('PUBLISHED', 'IN_PROGRESS') and o.seller_org_id is not null and coalesce(vv.fv, 0) < o.version) as farm_pending,
          count(*) filter (where o.status in ('PUBLISHED', 'IN_PROGRESS') and o.buyer_org_id is not null and coalesce(vv.bv, 0) < o.version) as buyer_pending,
          count(*) filter (where o.status in ('PUBLISHED', 'IN_PROGRESS') and o.seller_org_id is not null and coalesce(vv.fv, 0) < o.version
            and now() - coalesce(o.last_material_change_at, o.published_at, o.created_at) > make_interval(hours => ${sla}::int)) as farm_overdue,
          count(*) filter (where o.status in ('PUBLISHED', 'IN_PROGRESS') and o.buyer_org_id is not null and coalesce(vv.bv, 0) < o.version
            and now() - coalesce(o.last_material_change_at, o.published_at, o.created_at) > make_interval(hours => ${sla}::int)) as buyer_overdue,
          count(*) filter (where o.status in ${ACTIVE} and o.quantity is not null and o.loaded_qty > o.quantity * (1 + o.tolerance_pct / 100)) as over_tolerance
        from o
        -- Última versão visualizada por lado, agregada uma única vez (em vez de duas subconsultas por ordem).
        left join (
          select v.order_id, max(v.version) filter (where v.side = 'FARM') as fv, max(v.version) filter (where v.side = 'BUYER') as bv
          from loading_order_views v
          group by v.order_id
        ) vv on vv.order_id = o.id
      `);

      // ─── Logística e fiscal ───
      const [loads] = await tx.$queryRaw<Record<string, Dec>[]>(Prisma.sql`
        select
          -- Q41: carga pesada aguardando PDF + XML validados da Fazenda.
          count(*) filter (where l.status = 'AWAITING_FARM_INVOICE') as awaiting_invoice,
          count(*) filter (where l.status in ('SCHEDULED', 'CONFIRMED', 'AWAITING_LOADING', 'LOADING') and l.loading_date < ${today}::date) as late,
          count(*) filter (where l.status in ('IN_TRANSIT', 'ARRIVED')) as in_transit
        from loads l ${orderFilterJoin('l')}
      `);
      // Uma passada agregada por carga: XML rejeitado sem nota ativa e notas divergentes.
      const [inv] = await tx.$queryRaw<Record<string, Dec>[]>(Prisma.sql`
        select
          count(*) filter (where per_load.has_rejected and not per_load.has_active) as rejected_open,
          coalesce(sum(per_load.divergent), 0) as divergent
        from (
          select i.load_id,
            bool_or(i.status in ('VALID', 'DIVERGENT')) as has_active,
            bool_or(i.status = 'REJECTED') as has_rejected,
            count(*) filter (where i.status = 'DIVERGENT') as divergent
          from invoices i ${orderFilterJoin('i')}
          group by i.load_id
        ) per_load
      `);
      const [appt] = await tx.$queryRaw<Record<string, Dec>[]>(Prisma.sql`
        select
          count(*) filter (where a.status in ('REQUESTED', 'CONFIRMED') and a.carrier_partner_id is null and a.scheduled_on >= ${today}::date) as without_carrier,
          count(*) filter (where a.status in ('REQUESTED', 'CONFIRMED', 'CHECKED_IN') and a.scheduled_on = ${today}::date) as today
        from appointments a ${orderFilterJoin('a')}
      `);
      const [occ] = await tx.$queryRaw<Record<string, Dec>[]>(Prisma.sql`
        select
          count(*) filter (where oc.status in ('OPEN', 'IN_PROGRESS')) as open,
          count(*) filter (where oc.status in ('OPEN', 'IN_PROGRESS') and oc.due_on < ${today}::date) as overdue,
          count(*) filter (where oc.status in ('OPEN', 'IN_PROGRESS') and oc.severity in ('HIGH', 'CRITICAL')) as severe
        from occurrences oc ${orderFilterJoin('oc')}
      `);
      let blockedDocs: Dec = 0;
      if (isMatriz) {
        const [d] = await tx.$queryRaw<{ n: Dec }[]>(Prisma.sql`
          select count(*) as n from file_uploads
          where status in ('REJECTED', 'INFECTED') and kind <> 'NFE_XML' and created_at >= now() - interval '30 days'
        `);
        blockedDocs = d?.n;
      }

      // ─── Séries e distribuições ───
      // Série diária em uma passada pelas cargas, pelos momentos gravados (carregado/recebido) e seus índices parciais.
      const daily = await tx.$queryRaw<{ day: string; loaded_t: Dec; received_t: Dec }[]>(Prisma.sql`
        select to_char((d.at at time zone ${TZ})::date, 'YYYY-MM-DD') as day,
          sum(d.t) filter (where d.kind = 'L') as loaded_t,
          sum(d.t) filter (where d.kind = 'R') as received_t
        from loads l
        join loading_orders lo on lo.id = l.order_id
        left join units u on u.id = lo.unit_id
        cross join lateral (values
          ('L', l.loaded_at, coalesce(l.net_kg / 1000.0, l.expected_qty * coalesce(u.factor_to_kg, 1000) / 1000.0)),
          ('R', l.received_at, coalesce(l.received_qty * coalesce(u.factor_to_kg, 1000) / 1000.0, l.net_kg / 1000.0, 0))
        ) d(kind, at, t)
        where (l.loaded_at >= ${seriesStart} or l.received_at >= ${seriesStart}) and d.at >= ${seriesStart} and ${commodity('lo')}
        group by 1
      `);
      const loadedByDay = new Map(daily.map((r) => [r.day, r.loaded_t]));
      const receivedByDay = new Map(daily.map((r) => [r.day, r.received_t]));

      const todayByStatus = await tx.$queryRaw<{ status: string; n: Dec }[]>(Prisma.sql`
        select l.status::text as status, count(*) as n
        from loads l join loading_orders lo on lo.id = l.order_id
        where l.loading_date = ${today}::date and l.status <> 'CANCELLED' and ${commodity('lo')}
        group by 1
      `);
      const countByStatus = new Map(todayByStatus.map((r) => [r.status, int(r.n)]));

      const byCommodity = await tx.$queryRaw<{ id: string; name: string; ordered_t: Dec; loaded_t: Dec }[]>(Prisma.sql`
        ${ordersCte}
        select c.id, c.name, coalesce(sum(o.quantity * o.tf), 0) as ordered_t, coalesce(sum(o.loaded_qty * o.tf), 0) as loaded_t
        from o join commodities c on c.id = o.commodity_id
        where o.status in ${ACTIVE}
        group by c.id, c.name
        order by ordered_t desc
        limit 8
      `);

      const activeOrders = await tx.$queryRaw<
        { id: string; number: string; commodity: string | null; farm: string | null; seller: string | null; buyer: string | null; ordered_t: Dec; loaded_t: Dec }[]
      >(Prisma.sql`
        ${ordersCte}
        select o.id, o.number, c.name as commodity, f.name as farm,
          coalesce(sp.trade_name, sp.legal_name) as seller, coalesce(bp.trade_name, bp.legal_name) as buyer,
          o.quantity * o.tf as ordered_t, o.loaded_qty * o.tf as loaded_t
        from o
        left join commodities c on c.id = o.commodity_id
        left join farms f on f.id = o.farm_id
        left join business_partners sp on sp.id = o.seller_partner_id
        left join business_partners bp on bp.id = o.buyer_partner_id
        where o.status in ('PUBLISHED', 'IN_PROGRESS') and o.quantity is not null
        order by (o.quantity - o.loaded_qty) * o.tf desc
        limit 6
      `);

      const carriers = isMatriz
        ? await tx.$queryRaw<{ id: string; name: string; loads: Dec; loaded_t: Dec; divergent: Dec }[]>(Prisma.sql`
            select bp.id, coalesce(bp.trade_name, bp.legal_name) as name, count(*) as loads,
              coalesce(sum(l.net_kg), 0) / 1000.0 as loaded_t,
              count(*) filter (where l.received_qty is not null and l.net_kg > 0
                and abs(l.received_qty * coalesce(u.factor_to_kg, 1000) - l.net_kg) > l.net_kg * greatest(lo.tolerance_pct, 0.5) / 100) as divergent
            from loads l
            join loading_orders lo on lo.id = l.order_id
            left join units u on u.id = lo.unit_id
            join business_partners bp on bp.id = l.carrier_partner_id
            where l.status <> 'CANCELLED' and l.created_at >= ${seriesStart} and ${commodity('lo')}
            group by bp.id, name
            order by loads desc
            limit 6
          `)
        : [];

      // ─── Montagem por perfil ───
      const attention: AttentionItem[] =
        scope === 'MATRIZ'
          ? [
              item('pending_billing', 'Solicitações do Comprador aguardando faturamento', sig?.pending_billing, 'warning', '/ordens?status=PENDING_BILLING'),
              item('farm_view_overdue', 'OCs sem visualização da Fazenda no prazo', sig?.farm_overdue, 'danger', '/ordens?farmSignal=OVERDUE'),
              item('late_loads', 'Cargas atrasadas', loads?.late, 'danger', '/cargas?etapa=atrasadas'),
              item('rejected_invoices', 'Cargas com XML rejeitado', inv?.rejected_open, 'danger', '/documentos/nfe'),
              item('over_tolerance', 'OCs carregadas acima da tolerância', sig?.over_tolerance, 'danger', '/ordens'),
              item('occurrences_overdue', 'Ocorrências com prazo vencido', occ?.overdue, 'danger', '/ocorrencias'),
              item('buyer_view_overdue', 'OCs sem visualização do Comprador no prazo', sig?.buyer_overdue, 'warning', '/ordens?buyerSignal=OVERDUE'),
              item('awaiting_invoice', 'Cargas aguardando documentação fiscal da Fazenda', loads?.awaiting_invoice, 'warning', '/cargas?etapa=documentacao'),
              item('divergent_invoices', 'NF-e com divergência', inv?.divergent, 'warning', '/documentos/nfe'),
              item('occurrences_severe', 'Ocorrências altas ou críticas em aberto', occ?.severe, 'warning', '/ocorrencias'),
              item('appointments_without_carrier', 'Agendamentos sem transportadora', appt?.without_carrier, 'info', '/agendamentos'),
              item('documents_blocked', 'Documentos rejeitados nos últimos 30 dias', blockedDocs, 'info', '/documentos'),
              item('drafts', 'Rascunhos não publicados', sig?.drafts, 'primary', '/ordens?status=DRAFT'),
            ]
          : scope === 'FARM'
            ? [
                item('farm_view_pending', 'OCs novas ou alteradas para visualizar', sig?.farm_pending, 'danger', '/ordens'),
                item('rejected_invoices', 'Cargas com XML rejeitado', inv?.rejected_open, 'danger', '/documentos/nfe'),
                item('late_loads', 'Cargas atrasadas', loads?.late, 'danger', '/cargas?etapa=atrasadas'),
                item('awaiting_invoice', 'Cargas aguardando seu PDF e XML da NF-e', loads?.awaiting_invoice, 'danger', '/cargas?etapa=documentacao'),
                item('occurrences_open', 'Ocorrências em aberto', occ?.open, 'warning', '/ocorrencias'),
                item('appointments_today', 'Agendamentos para hoje', appt?.today, 'info', '/agendamentos'),
              ]
            : [
                item('buyer_returned', 'Solicitações devolvidas para ajuste', sig?.buyer_returned, 'danger', '/ordens?status=DRAFT'),
                item('buyer_pending_billing', 'Solicitações aguardando faturamento', sig?.pending_billing, 'info', '/ordens?status=PENDING_BILLING'),
                item('buyer_view_pending', 'OCs novas ou alteradas para visualizar', sig?.buyer_pending, 'danger', '/ordens'),
                item('divergent_invoices', 'NF-e com divergência', inv?.divergent, 'warning', '/documentos/nfe'),
                item('occurrences_open', 'Ocorrências compartilhadas em aberto', occ?.open, 'warning', '/ocorrencias'),
                item('in_transit', 'Cargas a caminho', loads?.in_transit, 'info', '/cargas?etapa=transit'),
              ];

      const ordered = new D((k?.ordered_t ?? 0).toString());
      const balance = D.max(ordered.minus((k?.loaded_t ?? 0).toString()).minus((k?.cancelled_t ?? 0).toString()), 0);

      return {
        scope,
        period: q.period,
        today,
        generatedAt: new Date().toISOString(),
        attention,
        kpis: {
          openOrders: int(k?.open_orders),
          publishedInPeriod: int(k?.published_in_period),
          orderedT: tons(k?.ordered_t),
          contractedT,
          releasedT: tons(k?.released_t),
          scheduledT: tons(k?.scheduled_t),
          loadedT: tons(k?.loaded_t),
          inTransitT: tons(k?.in_transit_t),
          receivedT: tons(k?.received_t),
          balanceT: tons(balance),
          loadedValue: isMatriz ? new D((k?.loaded_value ?? 0).toString()).toDecimalPlaces(2).toString() : null,
        },
        funnel: [
          ...(contractedT !== null ? [{ key: 'contracted', label: 'Contratado', valueT: contractedT }] : []),
          { key: 'ordered', label: 'Em ordens', valueT: tons(k?.ordered_t) },
          { key: 'released', label: 'Liberado', valueT: tons(k?.released_t) },
          { key: 'scheduled', label: 'Agendado', valueT: tons(k?.scheduled_t) },
          { key: 'loaded', label: 'Carregado', valueT: tons(k?.loaded_t) },
          { key: 'received', label: 'Recebido', valueT: tons(k?.received_t) },
        ],
        daily: Array.from({ length: days }, (_, i) => {
          const day = shiftDay(seriesFrom, i);
          return { day, loadedT: tons(loadedByDay.get(day)), receivedT: tons(receivedByDay.get(day)) };
        }),
        loadsToday: {
          total: [...countByStatus.values()].reduce((a, b) => a + b, 0),
          stages: LOAD_STAGES.map((s) => ({ key: s.key, label: s.label, count: s.statuses.reduce((a, st) => a + (countByStatus.get(st) ?? 0), 0) })),
        },
        byCommodity: byCommodity.map((r) => ({ id: r.id, name: r.name, orderedT: tons(r.ordered_t), loadedT: tons(r.loaded_t) })),
        activeOrders: activeOrders.map((r) => ({
          id: r.id,
          number: r.number,
          commodity: r.commodity,
          counterpart: scope === 'MATRIZ' ? (r.farm ?? r.seller) : scope === 'FARM' ? r.buyer : r.seller,
          orderedT: tons(r.ordered_t),
          loadedT: tons(r.loaded_t),
        })),
        carriers: carriers.map((r) => ({ id: r.id, name: r.name, loads: int(r.loads), loadedT: tons(r.loaded_t), divergentLoads: int(r.divergent) })),
      };
    });
  }
}
