import { RELEASE_EXPIRING_DAYS, type Page, type ReleaseListItem, type ReleaseListQuery, type ReleasesSummary } from '@ordens/contracts';
import { Prisma, type Tx } from '@ordens/db';
import { dec, day } from './orders.mapper.js';

const RELEASABLE_ORDER = ['PUBLISHED', 'IN_PROGRESS', 'SUSPENDED'];

const today = () => new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
const plusDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);
const unitLabel = (code: string | null | undefined) => (code === 'T' ? 't' : (code?.toLowerCase() ?? ''));

function where(query: ReleaseListQuery): Prisma.LoadingOrderReleaseWhereInput {
  const w: Prisma.LoadingOrderReleaseWhereInput = {};
  if (query.status?.length) w.status = { in: query.status };
  if (query.orderId) w.orderId = query.orderId;
  if (query.q) w.order = { number: { contains: query.q, mode: 'insensitive' } };
  if (query.from || query.to) {
    w.createdAt = {
      ...(query.from ? { gte: new Date(`${query.from}T00:00:00.000Z`) } : {}),
      ...(query.to ? { lt: plusDays(new Date(`${query.to}T00:00:00.000Z`), 1) } : {}),
    };
  }
  if (query.validity === 'overdue') {
    w.status = 'ACTIVE';
    w.validUntil = { lt: today() };
  } else if (query.validity === 'expiring') {
    w.status = 'ACTIVE';
    w.validUntil = { gte: today(), lte: plusDays(today(), RELEASE_EXPIRING_DAYS) };
  }
  return w;
}

/** Liberações visíveis a quem consulta (RLS herda a visibilidade da ordem). */
export async function listReleases(tx: Tx, query: ReleaseListQuery, canCancel: boolean): Promise<Page<ReleaseListItem>> {
  const filter = where(query);
  const [total, rows] = await Promise.all([
    tx.loadingOrderRelease.count({ where: filter }),
    tx.loadingOrderRelease.findMany({
      where: filter,
      orderBy: [{ createdAt: 'desc' }, { sequence: 'desc' }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      include: {
        order: { select: { id: true, number: true, status: true, version: true, farmId: true, buyerPartnerId: true, commodityId: true, unitId: true } },
      },
    }),
  ]);

  const ids = <K extends 'farmId' | 'buyerPartnerId' | 'commodityId' | 'unitId'>(k: K) => [...new Set(rows.map((r) => r.order[k]).filter((v): v is string => Boolean(v)))];
  const userIds = [...new Set(rows.flatMap((r) => [r.createdBy, r.cancelledBy]).filter((v): v is string => Boolean(v)))];
  const [farms, buyers, commodities, units, users] = await Promise.all([
    tx.farm.findMany({ where: { id: { in: ids('farmId') } }, select: { id: true, name: true } }),
    tx.businessPartner.findMany({ where: { id: { in: ids('buyerPartnerId') } }, select: { id: true, legalName: true, tradeName: true } }),
    tx.commodity.findMany({ where: { id: { in: ids('commodityId') } }, select: { id: true, name: true } }),
    tx.unit.findMany({ where: { id: { in: ids('unitId') } }, select: { id: true, code: true } }),
    userIds.length ? tx.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }) : [],
  ]);
  const farmMap = new Map(farms.map((f) => [f.id, { id: f.id, name: f.name }]));
  const buyerMap = new Map(buyers.map((b) => [b.id, { id: b.id, name: b.tradeName ?? b.legalName }]));
  const commodityMap = new Map(commodities.map((c) => [c.id, { id: c.id, name: c.name }]));
  const unitMap = new Map(units.map((u) => [u.id, unitLabel(u.code)]));
  const userMap = new Map(users.map((u) => [u.id, u.name]));
  const now = today();

  return {
    items: rows.map((r) => ({
      id: r.id,
      sequence: r.sequence,
      quantity: dec(r.quantity)!,
      validUntil: day(r.validUntil),
      status: r.status,
      notes: r.notes,
      orderVersion: r.orderVersion,
      createdAt: r.createdAt.toISOString(),
      createdBy: r.createdBy ? (userMap.get(r.createdBy) ?? null) : null,
      cancelledAt: r.cancelledAt?.toISOString() ?? null,
      cancelledBy: r.cancelledBy ? (userMap.get(r.cancelledBy) ?? null) : null,
      cancelReason: r.cancelReason,
      order: { id: r.order.id, number: r.order.number, status: r.order.status, version: r.order.version },
      farm: r.order.farmId ? (farmMap.get(r.order.farmId) ?? null) : null,
      buyer: r.order.buyerPartnerId ? (buyerMap.get(r.order.buyerPartnerId) ?? null) : null,
      commodity: r.order.commodityId ? (commodityMap.get(r.order.commodityId) ?? null) : null,
      unit: r.order.unitId ? (unitMap.get(r.order.unitId) ?? '') : '',
      overdue: r.status === 'ACTIVE' && Boolean(r.validUntil && r.validUntil < now),
      cancellable: canCancel && r.status === 'ACTIVE' && RELEASABLE_ORDER.includes(r.order.status),
    })),
    total,
    page: query.page,
    pageSize: query.pageSize,
  };
}

export async function releasesSummary(tx: Tx): Promise<ReleasesSummary> {
  const now = today();
  const [active, expiring, overdue, cancelled, byUnit] = await Promise.all([
    tx.loadingOrderRelease.count({ where: { status: 'ACTIVE' } }),
    tx.loadingOrderRelease.count({ where: { status: 'ACTIVE', validUntil: { gte: now, lte: plusDays(now, RELEASE_EXPIRING_DAYS) } } }),
    tx.loadingOrderRelease.count({ where: { status: 'ACTIVE', validUntil: { lt: now } } }),
    tx.loadingOrderRelease.count({ where: { status: 'CANCELLED' } }),
    tx.$queryRaw<{ code: string | null; qty: Prisma.Decimal }[]>`
      select u.code, sum(r.quantity) as qty
      from loading_order_releases r
      join loading_orders o on o.id = r.order_id
      left join units u on u.id = o.unit_id
      where r.status = 'ACTIVE'
      group by u.code`,
  ]);
  return {
    active,
    expiring,
    overdue,
    cancelled,
    activeQtyByUnit: Object.fromEntries(byUnit.map((r) => [unitLabel(r.code), new Prisma.Decimal(r.qty).toString()])),
  };
}
