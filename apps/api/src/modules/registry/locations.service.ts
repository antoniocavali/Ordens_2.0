import { Injectable } from '@nestjs/common';
import { ErrorCode, locationInputSchema, type LocationDetail, type LocationListItem, type Page, type RegistryListQuery } from '@ordens/contracts';
import { Prisma, type Tx } from '@ordens/db';
import type { z } from 'zod';
import { AppError } from '../../common/errors.js';
import { currentAuth } from '../../common/request-context.js';
import { TenantDb } from '../../infra/tenant-db.service.js';
import { likePattern } from './registry.util.js';

type LocationData = z.output<typeof locationInputSchema>;

interface LocationRow {
  id: string;
  kind: LocationListItem['kind'];
  name: string;
  code: string | null;
  partner_id: string | null;
  partner_name: string | null;
  city: string | null;
  state: string | null;
  has_coordinates: boolean;
  orders_count: bigint;
  status: LocationListItem['status'];
  archived: boolean;
  updated_at: Date;
  total: bigint;
}

function listSql(where: Prisma.Sql, limit: number, offset: number) {
  return Prisma.sql`
    select l.id, l.kind::text as kind, l.name, l.code, p.id as partner_id, coalesce(p.trade_name, p.legal_name) as partner_name,
      l.city, l.state, (l.latitude is not null and l.longitude is not null) as has_coordinates,
      (select count(*) from loading_orders lo
        where lo.status <> 'CANCELLED' and lower(lo.destination_name) = lower(l.name)
          and coalesce(lower(lo.destination_city), '') = coalesce(lower(l.city), '')
          and coalesce(lo.destination_state, '') = coalesce(l.state, '')) as orders_count,
      l.status::text as status, (l.archived_at is not null) as archived, l.updated_at, count(*) over () as total
    from locations l left join business_partners p on p.id = l.partner_id
    where ${where}
    order by l.name, l.id
    limit ${limit} offset ${offset}
  `;
}

const toItem = (r: LocationRow): LocationListItem => ({
  id: r.id,
  kind: r.kind,
  name: r.name,
  code: r.code,
  partner: r.partner_id ? { id: r.partner_id, name: r.partner_name ?? '' } : null,
  city: r.city,
  state: r.state,
  hasCoordinates: r.has_coordinates,
  ordersCount: Number(r.orders_count),
  status: r.status,
  archived: r.archived,
  updatedAt: r.updated_at.toISOString(),
});

/** Cadastro de locais de destino (Q39). Escrita só pela Matriz (API + RLS); leitura recortada pelo RLS. */
@Injectable()
export class LocationsService {
  constructor(private readonly db: TenantDb) {}

  list(q: RegistryListQuery): Promise<Page<LocationListItem>> {
    const conds: Prisma.Sql[] = [q.includeArchived ? Prisma.sql`true` : Prisma.sql`l.archived_at is null`];
    if (q.status) conds.push(Prisma.sql`l.status = ${q.status}::record_status`);
    if (q.partnerId) conds.push(Prisma.sql`l.partner_id = ${q.partnerId}::uuid`);
    if (q.q) {
      const p = likePattern(q.q);
      conds.push(Prisma.sql`(l.name ilike ${p} or l.code ilike ${p} or l.city ilike ${p} or p.legal_name ilike ${p} or p.trade_name ilike ${p})`);
    }
    return this.db.read(async (tx) => {
      const rows = await tx.$queryRaw<LocationRow[]>(listSql(Prisma.join(conds, ' and '), q.pageSize, (q.page - 1) * q.pageSize));
      return { items: rows.map(toItem), total: Number(rows[0]?.total ?? 0), page: q.page, pageSize: q.pageSize };
    });
  }

  detail(id: string): Promise<LocationDetail> {
    return this.db.read((tx) => this.loadDetail(tx, id));
  }

  create(input: LocationData): Promise<LocationDetail> {
    const auth = currentAuth();
    this.assertMatriz();
    return this.db.write(async ({ tx, audit }) => {
      await this.assertPartner(tx, input.partnerId ?? null);
      await this.assertUniqueCode(tx, input.code ?? null, null);
      const location = await tx.location.create({ data: { tenantId: auth.membership!.tenantId, createdBy: auth.userId, ...this.data(input) } });
      await audit({ entityType: 'location', entityId: location.id, action: 'location.created', after: this.auditView(input) });
      return this.loadDetail(tx, location.id);
    });
  }

  update(id: string, input: LocationData): Promise<LocationDetail> {
    this.assertMatriz();
    return this.db.write(async ({ tx, audit }) => {
      const before = await tx.location.findUnique({ where: { id } });
      if (!before) throw AppError.notFound('Local não encontrado.');
      await this.assertPartner(tx, input.partnerId ?? null);
      await this.assertUniqueCode(tx, input.code ?? null, id);
      await tx.location.update({ where: { id }, data: this.data(input) });
      await audit({
        entityType: 'location',
        entityId: id,
        action: 'location.updated',
        before: { kind: before.kind, name: before.name, code: before.code, partnerId: before.partnerId, city: before.city, state: before.state, status: before.status },
        after: this.auditView(input),
      });
      return this.loadDetail(tx, id);
    });
  }

  setArchived(id: string, archived: boolean): Promise<LocationDetail> {
    this.assertMatriz();
    return this.db.write(async ({ tx, audit }) => {
      const location = await tx.location.findUnique({ where: { id } });
      if (!location) throw AppError.notFound('Local não encontrado.');
      await tx.location.update({ where: { id }, data: { archivedAt: archived ? new Date() : null } });
      await audit({ entityType: 'location', entityId: id, action: archived ? 'location.archived' : 'location.restored' });
      return this.loadDetail(tx, id);
    });
  }

  /** Cadastro de locais é da Matriz, mesmo que um papel personalizado externo tenha partner.manage. */
  private assertMatriz() {
    const scope = currentAuth().membership?.scope;
    if (scope !== 'MATRIZ') throw AppError.forbidden('Somente a Matriz cadastra locais.');
  }

  private async assertPartner(tx: Tx, partnerId: string | null) {
    if (!partnerId) return;
    const partner = await tx.businessPartner.findUnique({ where: { id: partnerId }, include: { roles: true } });
    if (!partner || partner.archivedAt) {
      throw AppError.domain(ErrorCode.INCONSISTENT_RELATION, 'Parceiro não encontrado.', { fields: { partnerId: ['Selecione um parceiro válido'] } });
    }
    if (!partner.roles.some((r) => r.role === 'BUYER')) {
      throw AppError.domain(ErrorCode.INCONSISTENT_RELATION, 'O local só pode ser vinculado a um comprador.', { fields: { partnerId: ['Parceiro sem papel de comprador'] } });
    }
  }

  private async assertUniqueCode(tx: Tx, code: string | null, exceptId: string | null) {
    if (!code) return;
    const clash = await tx.location.findFirst({ where: { code: { equals: code, mode: 'insensitive' }, ...(exceptId ? { id: { not: exceptId } } : {}) }, select: { name: true } });
    if (clash) throw AppError.conflict(`Código já usado por ${clash.name}.`, ErrorCode.CONFLICT, { fields: { code: [`Código já usado por ${clash.name}`] } });
  }

  private data(i: LocationData) {
    return {
      kind: i.kind,
      name: i.name,
      code: i.code ?? null,
      partnerId: i.partnerId ?? null,
      zipCode: i.zipCode ?? null,
      address: i.address ?? null,
      city: i.city ?? null,
      state: i.state ?? null,
      latitude: i.latitude ?? null,
      longitude: i.longitude ?? null,
      operatingHours: i.operatingHours ?? null,
      receivingInstructions: i.receivingInstructions ?? null,
      contactName: i.contactName ?? null,
      contactPhone: i.contactPhone ?? null,
      notes: i.notes ?? null,
      status: i.status,
    };
  }

  private auditView(i: LocationData) {
    return { kind: i.kind, name: i.name, code: i.code ?? null, partnerId: i.partnerId ?? null, city: i.city ?? null, state: i.state ?? null, status: i.status };
  }

  private async loadDetail(tx: Tx, id: string): Promise<LocationDetail> {
    const [row] = await tx.$queryRaw<LocationRow[]>(listSql(Prisma.sql`l.id = ${id}::uuid`, 1, 0));
    if (!row) throw AppError.notFound('Local não encontrado.');
    const l = await tx.location.findUniqueOrThrow({ where: { id } });
    return {
      ...toItem(row),
      zipCode: l.zipCode,
      address: l.address,
      latitude: l.latitude?.toString() ?? null,
      longitude: l.longitude?.toString() ?? null,
      operatingHours: l.operatingHours,
      receivingInstructions: l.receivingInstructions,
      contactName: l.contactName,
      contactPhone: l.contactPhone,
      notes: l.notes,
    };
  }
}
