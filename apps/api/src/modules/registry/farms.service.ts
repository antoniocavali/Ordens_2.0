import { Injectable } from '@nestjs/common';
import { ErrorCode, farmInputSchema, type FarmDetail, type FarmListItem, type Page, type RegistryListQuery } from '@ordens/contracts';
import { Prisma, type Tx } from '@ordens/db';
import type { z } from 'zod';
import { AppError } from '../../common/errors.js';
import { currentAuth } from '../../common/request-context.js';
import { TenantDb } from '../../infra/tenant-db.service.js';
import { likePattern } from './registry.util.js';

type FarmData = z.output<typeof farmInputSchema>;
const SELLER_ROLES = ['SELLER', 'PRODUCER', 'COOPERATIVE_MEMBER', 'COOPERATIVE'] as const;

interface FarmRow {
  id: string;
  name: string;
  code: string | null;
  owner_id: string;
  owner_name: string;
  city: string | null;
  state: string | null;
  loading_point: string | null;
  daily_capacity: Prisma.Decimal | null;
  has_coordinates: boolean;
  orders_count: bigint;
  open_qty: Prisma.Decimal;
  status: FarmListItem['status'];
  updated_at: Date;
  total: bigint;
}

function listSql(where: Prisma.Sql, limit: number, offset: number) {
  return Prisma.sql`
    select f.id, f.name, f.code, p.id as owner_id, coalesce(p.trade_name, p.legal_name) as owner_name, f.city, f.state,
      f.loading_point, f.daily_capacity, (f.latitude is not null and f.longitude is not null) as has_coordinates,
      (select count(*) from loading_orders lo where lo.farm_id = f.id and lo.status <> 'CANCELLED') as orders_count,
      (select coalesce(sum(greatest(lo.quantity - lo.loaded_qty - lo.cancelled_qty, 0)), 0) from loading_orders lo
        where lo.farm_id = f.id and lo.status in ('PUBLISHED', 'IN_PROGRESS', 'SUSPENDED')) as open_qty,
      f.status::text as status, f.updated_at, count(*) over () as total
    from farms f join business_partners p on p.id = f.owner_partner_id
    where ${where}
    order by f.name, f.id
    limit ${limit} offset ${offset}
  `;
}

const toItem = (r: FarmRow): FarmListItem => ({
  id: r.id,
  name: r.name,
  code: r.code,
  owner: { id: r.owner_id, name: r.owner_name },
  city: r.city,
  state: r.state,
  loadingPoint: r.loading_point,
  dailyCapacity: r.daily_capacity ? new Prisma.Decimal(r.daily_capacity).toString() : null,
  hasCoordinates: r.has_coordinates,
  ordersCount: Number(r.orders_count),
  openQuantity: new Prisma.Decimal(r.open_qty).toString(),
  status: r.status,
  updatedAt: r.updated_at.toISOString(),
});

@Injectable()
export class FarmsService {
  constructor(private readonly db: TenantDb) {}

  list(q: RegistryListQuery): Promise<Page<FarmListItem>> {
    const conds: Prisma.Sql[] = [q.includeArchived ? Prisma.sql`true` : Prisma.sql`f.archived_at is null`];
    if (q.status) conds.push(Prisma.sql`f.status = ${q.status}::record_status`);
    if (q.partnerId) conds.push(Prisma.sql`f.owner_partner_id = ${q.partnerId}::uuid`);
    if (q.q) {
      const p = likePattern(q.q);
      conds.push(Prisma.sql`(f.name ilike ${p} or f.code ilike ${p} or f.city ilike ${p} or p.legal_name ilike ${p} or p.trade_name ilike ${p})`);
    }
    return this.db.read(async (tx) => {
      const rows = await tx.$queryRaw<FarmRow[]>(listSql(Prisma.join(conds, ' and '), q.pageSize, (q.page - 1) * q.pageSize));
      return { items: rows.map(toItem), total: Number(rows[0]?.total ?? 0), page: q.page, pageSize: q.pageSize };
    });
  }

  detail(id: string): Promise<FarmDetail> {
    return this.db.read((tx) => this.loadDetail(tx, id));
  }

  create(input: FarmData): Promise<FarmDetail> {
    const auth = currentAuth();
    return this.db.write(async ({ tx, audit }) => {
      const organizationId = await this.resolveOwner(tx, input.ownerPartnerId);
      const farm = await tx.farm.create({ data: { tenantId: auth.membership!.tenantId, organizationId, ...this.farmData(input) } });
      await audit({ entityType: 'farm', entityId: farm.id, action: 'farm.created', after: input });
      return this.loadDetail(tx, farm.id);
    });
  }

  update(id: string, input: FarmData): Promise<FarmDetail> {
    return this.db.write(async ({ tx, audit }) => {
      const before = await tx.farm.findUnique({ where: { id } });
      if (!before) throw AppError.notFound('Fazenda não encontrada.');
      let organizationId = before.organizationId;
      if (before.ownerPartnerId !== input.ownerPartnerId) {
        const orders = await tx.loadingOrder.count({ where: { farmId: id } });
        if (orders) {
          throw AppError.domain(ErrorCode.INCONSISTENT_RELATION, `O proprietário não pode ser alterado: a fazenda possui ${orders} ordem(ns).`, {
            fields: { ownerPartnerId: ['Proprietário travado por ordens existentes'] },
          });
        }
        organizationId = await this.resolveOwner(tx, input.ownerPartnerId);
      }
      await tx.farm.update({ where: { id }, data: { organizationId, ...this.farmData(input) } });
      await audit({
        entityType: 'farm',
        entityId: id,
        action: 'farm.updated',
        before: { name: before.name, ownerPartnerId: before.ownerPartnerId, status: before.status, city: before.city },
        after: { name: input.name, ownerPartnerId: input.ownerPartnerId, status: input.status, city: input.city },
      });
      return this.loadDetail(tx, id);
    });
  }

  setArchived(id: string, archived: boolean): Promise<FarmDetail> {
    return this.db.write(async ({ tx, audit }) => {
      const farm = await tx.farm.findUnique({ where: { id } });
      if (!farm) throw AppError.notFound('Fazenda não encontrada.');
      if (archived) {
        const open = await tx.loadingOrder.count({ where: { farmId: id, status: { in: ['DRAFT', 'PUBLISHED', 'IN_PROGRESS', 'SUSPENDED'] } } });
        if (open) throw AppError.domain(ErrorCode.INCONSISTENT_RELATION, `Há ${open} ordem(ns) em aberto nesta fazenda.`);
      }
      await tx.farm.update({ where: { id }, data: { archivedAt: archived ? new Date() : null } });
      await audit({ entityType: 'farm', entityId: id, action: archived ? 'farm.archived' : 'farm.restored' });
      return this.loadDetail(tx, id);
    });
  }

  /** Valida o proprietário e retorna a organização FARM vinculada (se houver). Fazenda só cadastra para si. */
  private async resolveOwner(tx: Tx, ownerPartnerId: string): Promise<string | null> {
    const auth = currentAuth();
    const owner = await tx.businessPartner.findUnique({ where: { id: ownerPartnerId }, include: { roles: true, organizations: { where: { kind: 'FARM' } } } });
    if (!owner || owner.archivedAt) throw AppError.domain(ErrorCode.INCONSISTENT_RELATION, 'Proprietário não encontrado.', { fields: { ownerPartnerId: ['Selecione um parceiro válido'] } });
    if (!owner.roles.some((r) => (SELLER_ROLES as readonly string[]).includes(r.role))) {
      throw AppError.domain(ErrorCode.INCONSISTENT_RELATION, 'O proprietário precisa ser vendedor, produtor, cooperado ou cooperativa.', {
        fields: { ownerPartnerId: ['Parceiro sem papel de vendedor/produtor'] },
      });
    }
    const orgId = owner.organizations[0]?.id ?? null;
    if (auth.membership!.scope === 'FARM' && orgId !== auth.membership!.organizationId) throw AppError.forbidden();
    return orgId;
  }

  private farmData(i: FarmData) {
    return {
      ownerPartnerId: i.ownerPartnerId,
      name: i.name,
      code: i.code ?? null,
      stateRegistration: i.stateRegistration ?? null,
      zipCode: i.zipCode ?? null,
      address: i.address ?? null,
      city: i.city ?? null,
      state: i.state ?? null,
      latitude: i.latitude ?? null,
      longitude: i.longitude ?? null,
      loadingPoint: i.loadingPoint ?? null,
      operatingHours: i.operatingHours ? { text: i.operatingHours } : Prisma.JsonNull,
      dailyCapacity: i.dailyCapacity ?? null,
      accessRestrictions: i.accessRestrictions ?? null,
      carrierInstructions: i.carrierInstructions ?? null,
      contactName: i.contactName ?? null,
      contactPhone: i.contactPhone ?? null,
      notes: i.notes ?? null,
      status: i.status,
    };
  }

  private async loadDetail(tx: Tx, id: string): Promise<FarmDetail> {
    const [row] = await tx.$queryRaw<FarmRow[]>(listSql(Prisma.sql`f.id = ${id}::uuid`, 1, 0));
    if (!row) throw AppError.notFound('Fazenda não encontrada.');
    const f = await tx.farm.findUniqueOrThrow({ where: { id } });
    const hours = f.operatingHours as { text?: string; weekdays?: string; saturday?: string } | null;
    return {
      ...toItem(row),
      stateRegistration: f.stateRegistration,
      zipCode: f.zipCode,
      address: f.address,
      latitude: f.latitude?.toString() ?? null,
      longitude: f.longitude?.toString() ?? null,
      operatingHours: hours?.text ?? ([hours?.weekdays && `Seg–Sex ${hours.weekdays}`, hours?.saturday && `Sáb ${hours.saturday}`].filter(Boolean).join(' · ') || null),
      accessRestrictions: f.accessRestrictions,
      carrierInstructions: f.carrierInstructions,
      contactName: f.contactName,
      contactPhone: f.contactPhone,
      notes: f.notes,
    };
  }
}
