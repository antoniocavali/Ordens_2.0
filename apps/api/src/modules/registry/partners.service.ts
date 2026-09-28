import { Injectable } from '@nestjs/common';
import {
  ErrorCode,
  formatDocument,
  partnerInputSchema,
  PARTNER_ROLE_LABELS,
  type Page,
  type PartnerDetail,
  type PartnerListItem,
  type PartnerRole,
  type RegistryListQuery,
} from '@ordens/contracts';
import { Prisma, type Tx } from '@ordens/db';
import type { z } from 'zod';
import { AppError } from '../../common/errors.js';
import { TenantDb } from '../../infra/tenant-db.service.js';
import { currentAuth } from '../../common/request-context.js';
import { likePattern } from './registry.util.js';

type PartnerData = z.output<typeof partnerInputSchema>;

interface PartnerRow {
  id: string;
  person_type: 'PF' | 'PJ';
  legal_name: string;
  trade_name: string | null;
  document: string;
  city: string | null;
  state: string | null;
  email: string | null;
  phone: string | null;
  status: PartnerListItem['status'];
  archived_at: Date | null;
  updated_at: Date;
  roles: PartnerRole[];
  farms_count: bigint;
  orders_count: bigint;
  open_qty: Prisma.Decimal;
  has_portal: boolean;
  total: bigint;
}

function listSql(where: Prisma.Sql, limit: number, offset: number) {
  return Prisma.sql`
    select p.id, p.person_type::text as person_type, p.legal_name, p.trade_name, p.document, p.city, p.state, p.email, p.phone,
      p.status::text as status, p.archived_at, p.updated_at,
      array(select r.role::text from partner_roles r where r.partner_id = p.id order by r.role) as roles,
      (select count(*) from farms f where f.owner_partner_id = p.id and f.archived_at is null) as farms_count,
      (select count(*) from loading_orders lo where (lo.seller_partner_id = p.id or lo.buyer_partner_id = p.id) and lo.status <> 'CANCELLED') as orders_count,
      (select coalesce(sum(greatest(lo.quantity - lo.loaded_qty - lo.cancelled_qty, 0)), 0) from loading_orders lo
        where (lo.seller_partner_id = p.id or lo.buyer_partner_id = p.id) and lo.status in ('PUBLISHED', 'IN_PROGRESS', 'SUSPENDED')) as open_qty,
      exists (select 1 from organizations o where o.partner_id = p.id) as has_portal,
      count(*) over () as total
    from business_partners p
    where ${where}
    order by p.legal_name, p.id
    limit ${limit} offset ${offset}
  `;
}

const toItem = (r: PartnerRow): PartnerListItem => ({
  id: r.id,
  personType: r.person_type,
  legalName: r.legal_name,
  tradeName: r.trade_name,
  document: formatDocument(r.document),
  roles: r.roles,
  city: r.city,
  state: r.state,
  email: r.email,
  phone: r.phone,
  status: r.status,
  farmsCount: Number(r.farms_count),
  ordersCount: Number(r.orders_count),
  openQuantity: new Prisma.Decimal(r.open_qty).toString(),
  hasPortal: r.has_portal,
  archived: Boolean(r.archived_at),
  updatedAt: r.updated_at.toISOString(),
});

/** Papéis que não podem ser removidos enquanto houver vínculos operacionais. */
const ROLE_GUARDS: Partial<Record<PartnerRole, (tx: Tx, id: string) => Promise<number>>> = {
  SELLER: (tx, id) => tx.loadingOrder.count({ where: { sellerPartnerId: id, status: { not: 'CANCELLED' } } }),
  BUYER: (tx, id) => tx.loadingOrder.count({ where: { buyerPartnerId: id, status: { not: 'CANCELLED' } } }),
};

@Injectable()
export class PartnersService {
  constructor(private readonly db: TenantDb) {}

  list(q: RegistryListQuery): Promise<Page<PartnerListItem>> {
    const conds: Prisma.Sql[] = [q.includeArchived ? Prisma.sql`true` : Prisma.sql`p.archived_at is null`];
    if (q.status) conds.push(Prisma.sql`p.status = ${q.status}::record_status`);
    if (q.role) conds.push(Prisma.sql`exists (select 1 from partner_roles r where r.partner_id = p.id and r.role = ${q.role}::partner_role)`);
    if (q.q) {
      const p = likePattern(q.q);
      const digits = q.q.replace(/\D/g, '');
      conds.push(
        digits.length >= 3
          ? Prisma.sql`(p.legal_name ilike ${p} or p.trade_name ilike ${p} or p.city ilike ${p} or p.document like ${`%${digits}%`})`
          : Prisma.sql`(p.legal_name ilike ${p} or p.trade_name ilike ${p} or p.city ilike ${p})`,
      );
    }
    return this.db.read(async (tx) => {
      const rows = await tx.$queryRaw<PartnerRow[]>(listSql(Prisma.join(conds, ' and '), q.pageSize, (q.page - 1) * q.pageSize));
      return { items: rows.map(toItem), total: Number(rows[0]?.total ?? 0), page: q.page, pageSize: q.pageSize };
    });
  }

  detail(id: string): Promise<PartnerDetail> {
    return this.db.read((tx) => this.loadDetail(tx, id));
  }

  create(input: PartnerData): Promise<PartnerDetail> {
    const tenantId = currentAuth().membership!.tenantId;
    return this.db.write(async ({ tx, audit }) => {
      await this.assertDocumentFree(tx, input.document, null);
      const partner = await tx.businessPartner.create({
        data: { tenantId, createdBy: currentAuth().userId, updatedBy: currentAuth().userId, ...this.partnerData(input) },
      });
      await this.syncChildren(tx, tenantId, partner.id, input);
      await audit({ entityType: 'partner', entityId: partner.id, action: 'partner.created', after: { ...input, contacts: input.contacts.length } });
      return this.loadDetail(tx, partner.id);
    });
  }

  update(id: string, input: PartnerData): Promise<PartnerDetail> {
    const tenantId = currentAuth().membership!.tenantId;
    return this.db.write(async ({ tx, audit }) => {
      const before = await tx.businessPartner.findUnique({ where: { id }, include: { roles: true } });
      if (!before) throw AppError.notFound('Parceiro não encontrado.');
      await this.assertDocumentFree(tx, input.document, id);

      const removed = before.roles.map((r) => r.role).filter((r) => !input.roles.includes(r));
      for (const role of removed) {
        const guard = ROLE_GUARDS[role];
        const inUse = guard ? await guard(tx, id) : 0;
        if (inUse > 0) {
          throw AppError.domain(ErrorCode.INCONSISTENT_RELATION, `Não é possível remover o papel ${PARTNER_ROLE_LABELS[role]}: há ${inUse} vínculo(s) ativo(s).`, {
            fields: { roles: [`${PARTNER_ROLE_LABELS[role]} está em uso`] },
          });
        }
      }
      if (before.document !== input.document) {
        const orders = await tx.loadingOrder.count({ where: { OR: [{ sellerPartnerId: id }, { buyerPartnerId: id }] } });
        if (orders > 0) {
          throw AppError.domain(ErrorCode.INCONSISTENT_RELATION, 'O CPF/CNPJ não pode ser alterado: o parceiro já possui ordens.', { fields: { document: ['Documento travado por vínculos'] } });
        }
      }

      await tx.businessPartner.update({ where: { id }, data: { ...this.partnerData(input), updatedBy: currentAuth().userId } });
      await this.syncChildren(tx, tenantId, id, input);
      await audit({
        entityType: 'partner',
        entityId: id,
        action: 'partner.updated',
        before: { legalName: before.legalName, tradeName: before.tradeName, document: before.document, status: before.status, roles: before.roles.map((r) => r.role) },
        after: { legalName: input.legalName, tradeName: input.tradeName, document: input.document, status: input.status, roles: input.roles },
      });
      return this.loadDetail(tx, id);
    });
  }

  setArchived(id: string, archived: boolean): Promise<PartnerDetail> {
    return this.db.write(async ({ tx, audit }) => {
      const p = await tx.businessPartner.findUnique({ where: { id } });
      if (!p) throw AppError.notFound('Parceiro não encontrado.');
      if (archived) {
        const open = await tx.loadingOrder.count({
          where: { OR: [{ sellerPartnerId: id }, { buyerPartnerId: id }], status: { in: ['DRAFT', 'PUBLISHED', 'IN_PROGRESS', 'SUSPENDED'] } },
        });
        if (open) throw AppError.domain(ErrorCode.INCONSISTENT_RELATION, `Há ${open} ordem(ns) em aberto com este parceiro. Conclua ou cancele antes de arquivar.`);
      }
      await tx.businessPartner.update({ where: { id }, data: { archivedAt: archived ? new Date() : null, updatedBy: currentAuth().userId } });
      await audit({ entityType: 'partner', entityId: id, action: archived ? 'partner.archived' : 'partner.restored' });
      return this.loadDetail(tx, id);
    });
  }

  // ───────────────────────────── Internos ─────────────────────────────

  private partnerData(i: PartnerData) {
    return {
      personType: i.personType,
      legalName: i.legalName,
      tradeName: i.tradeName ?? null,
      document: i.document,
      stateRegistration: i.stateRegistration ?? null,
      email: i.email ?? null,
      phone: i.phone ?? null,
      zipCode: i.zipCode ?? null,
      address: i.address ?? null,
      city: i.city ?? null,
      state: i.state ?? null,
      notes: i.notes ?? null,
      status: i.status,
    };
  }

  private async syncChildren(tx: Tx, tenantId: string, partnerId: string, input: PartnerData) {
    await tx.partnerRoleAssignment.deleteMany({ where: { partnerId, role: { notIn: input.roles } } });
    await tx.partnerRoleAssignment.createMany({ data: input.roles.map((role) => ({ partnerId, role, tenantId })), skipDuplicates: true });

    await tx.partnerContact.deleteMany({ where: { partnerId } });
    if (input.contacts.length) {
      const hasPrimary = input.contacts.some((c) => c.isPrimary);
      await tx.partnerContact.createMany({
        data: input.contacts.map((c, i) => ({
          tenantId,
          partnerId,
          name: c.name,
          role: c.role ?? null,
          phone: c.phone ?? null,
          email: c.email ?? null,
          isPrimary: hasPrimary ? c.isPrimary : i === 0,
        })),
      });
    }

    if (input.roles.includes('CARRIER')) {
      const cp = input.carrierProfile ?? {};
      const data = {
        rntrc: cp.rntrc ?? null,
        rntrcExpiresAt: cp.rntrcExpiresAt ? new Date(`${cp.rntrcExpiresAt}T00:00:00Z`) : null,
        opsContactName: cp.opsContactName ?? null,
        opsContactPhone: cp.opsContactPhone ?? null,
        opsContactEmail: cp.opsContactEmail ?? null,
      };
      await tx.carrierProfile.upsert({ where: { partnerId }, create: { partnerId, tenantId, ...data }, update: data });
    }
  }

  private async assertDocumentFree(tx: Tx, document: string, exceptId: string | null) {
    const existing = await tx.businessPartner.findFirst({
      where: { document, ...(exceptId ? { id: { not: exceptId } } : {}) },
      select: { legalName: true, archivedAt: true },
    });
    if (existing) {
      throw AppError.conflict(`Já existe um parceiro com este documento: ${existing.legalName}${existing.archivedAt ? ' (arquivado)' : ''}.`, ErrorCode.CONFLICT, {
        fields: { document: ['Documento já cadastrado — um mesmo parceiro pode ter vários papéis'] },
      });
    }
  }

  private async loadDetail(tx: Tx, id: string): Promise<PartnerDetail> {
    const [row] = await tx.$queryRaw<PartnerRow[]>(listSql(Prisma.sql`p.id = ${id}::uuid`, 1, 0));
    if (!row) throw AppError.notFound('Parceiro não encontrado.');
    const p = await tx.businessPartner.findUniqueOrThrow({
      where: { id },
      include: {
        contacts: { orderBy: [{ isPrimary: 'desc' }, { name: 'asc' }] },
        carrierProfile: true,
        farms: { where: { archivedAt: null }, orderBy: { name: 'asc' }, select: { id: true, name: true, city: true, state: true, status: true } },
      },
    });
    const contractsCount = await tx.contract.count({ where: { OR: [{ sellerPartnerId: id }, { buyerPartnerId: id }] } });
    const cp = p.carrierProfile;
    return {
      ...toItem(row),
      stateRegistration: p.stateRegistration,
      zipCode: p.zipCode,
      address: p.address,
      notes: p.notes,
      contacts: p.contacts.map((c) => ({ id: c.id, name: c.name, role: c.role, phone: c.phone, email: c.email, isPrimary: c.isPrimary })),
      carrierProfile: cp
        ? {
            rntrc: cp.rntrc,
            rntrcExpiresAt: cp.rntrcExpiresAt?.toISOString().slice(0, 10) ?? null,
            opsContactName: cp.opsContactName,
            opsContactPhone: cp.opsContactPhone,
            opsContactEmail: cp.opsContactEmail,
          }
        : null,
      farms: p.farms,
      contractsCount,
      createdAt: p.createdAt.toISOString(),
    };
  }
}
