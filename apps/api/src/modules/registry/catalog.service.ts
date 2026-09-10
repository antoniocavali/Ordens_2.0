import { Injectable } from '@nestjs/common';
import {
  commodityInputSchema,
  driverInputSchema,
  ErrorCode,
  vehicleInputSchema,
  type CommodityListItem,
  type DriverListItem,
  type Page,
  type RegistryListQuery,
  type VehicleListItem,
} from '@ordens/contracts';
import { Prisma, type Tx } from '@ordens/db';
import type { z } from 'zod';
import { AppError } from '../../common/errors.js';
import { currentAuth } from '../../common/request-context.js';
import { TenantDb } from '../../infra/tenant-db.service.js';
import { fromDate, toDate } from './registry.util.js';

type CommodityData = z.output<typeof commodityInputSchema>;
type DriverData = z.output<typeof driverInputSchema>;
type VehicleData = z.output<typeof vehicleInputSchema>;

const DAY = 86_400_000;
const text = (q?: string) => (q ? { contains: q, mode: 'insensitive' as const } : undefined);

function cnhStatus(expires: Date | null): DriverListItem['cnhStatus'] {
  if (!expires) return 'UNKNOWN';
  const diff = expires.getTime() - Date.now();
  if (diff < 0) return 'EXPIRED';
  return diff < 30 * DAY ? 'EXPIRING' : 'OK';
}

async function assertCarrier(tx: Tx, carrierPartnerId: string | null | undefined) {
  if (!carrierPartnerId) return;
  const role = await tx.partnerRoleAssignment.findFirst({ where: { partnerId: carrierPartnerId, role: 'CARRIER' } });
  if (!role) {
    throw AppError.domain(ErrorCode.INCONSISTENT_RELATION, 'O parceiro selecionado não é transportadora.', { fields: { carrierPartnerId: ['Selecione uma transportadora'] } });
  }
}

/** Commodities, motoristas e veículos: cadastros de estrutura simples. */
@Injectable()
export class CatalogService {
  constructor(private readonly db: TenantDb) {}

  // ───────────────────────────── Commodities ─────────────────────────────

  listCommodities(q: RegistryListQuery): Promise<Page<CommodityListItem>> {
    return this.db.read(async (tx) => {
      const where: Prisma.CommodityWhereInput = {
        ...(q.status ? { status: q.status } : {}),
        ...(q.q ? { OR: [{ name: text(q.q) }, { code: text(q.q) }, { category: text(q.q) }] } : {}),
      };
      const [total, rows, units] = await Promise.all([
        tx.commodity.count({ where }),
        tx.commodity.findMany({ where, orderBy: { name: 'asc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
        tx.unit.findMany(),
      ]);
      const counts = await tx.loadingOrder.groupBy({ by: ['commodityId'], where: { commodityId: { in: rows.map((r) => r.id) } }, _count: true });
      const unitMap = new Map(units.map((u) => [u.id, u]));
      return {
        total,
        page: q.page,
        pageSize: q.pageSize,
        items: rows.map((c) => ({
          id: c.id,
          code: c.code,
          name: c.name,
          category: c.category,
          description: c.description,
          defaultUnit: c.defaultUnitId && unitMap.get(c.defaultUnitId) ? { id: c.defaultUnitId, code: unitMap.get(c.defaultUnitId)!.code } : null,
          ordersCount: counts.find((x) => x.commodityId === c.id)?._count ?? 0,
          status: c.status,
          updatedAt: c.updatedAt.toISOString(),
        })),
      };
    });
  }

  saveCommodity(id: string | null, input: CommodityData) {
    const tenantId = currentAuth().membership!.tenantId;
    return this.db.write(async ({ tx, audit }) => {
      const dup = await tx.commodity.findFirst({ where: { code: input.code, ...(id ? { id: { not: id } } : {}) } });
      if (dup) throw AppError.conflict('Já existe uma commodity com este código.', ErrorCode.CONFLICT, { fields: { code: ['Código em uso'] } });
      const data = { code: input.code, name: input.name, category: input.category ?? null, defaultUnitId: input.defaultUnitId ?? null, description: input.description ?? null, status: input.status };
      const before = id ? await tx.commodity.findUnique({ where: { id } }) : null;
      if (id && !before) throw AppError.notFound('Commodity não encontrada.');
      const saved = id ? await tx.commodity.update({ where: { id }, data }) : await tx.commodity.create({ data: { tenantId, ...data } });
      await audit({ entityType: 'commodity', entityId: saved.id, action: id ? 'commodity.updated' : 'commodity.created', before, after: data });
      return { id: saved.id };
    });
  }

  // ───────────────────────────── Motoristas ─────────────────────────────

  listDrivers(q: RegistryListQuery): Promise<Page<DriverListItem>> {
    return this.db.read(async (tx) => {
      const digits = q.q?.replace(/\D/g, '') ?? '';
      const where: Prisma.DriverWhereInput = {
        ...(q.includeArchived ? {} : { archivedAt: null }),
        ...(q.status ? { status: q.status } : {}),
        ...(q.partnerId ? { carrierPartnerId: q.partnerId } : {}),
        ...(q.q ? { OR: [{ name: text(q.q) }, ...(digits.length >= 3 ? [{ cpf: { contains: digits } }] : []), { phone: { contains: digits || q.q } }] } : {}),
      };
      const [total, rows] = await Promise.all([
        tx.driver.count({ where }),
        tx.driver.findMany({
          where,
          include: { carrier: { select: { id: true, legalName: true, tradeName: true } } },
          orderBy: { name: 'asc' },
          skip: (q.page - 1) * q.pageSize,
          take: q.pageSize,
        }),
      ]);
      return {
        total,
        page: q.page,
        pageSize: q.pageSize,
        items: rows.map((d) => ({
          id: d.id,
          name: d.name,
          cpf: d.cpf,
          phone: d.phone,
          carrier: d.carrier ? { id: d.carrier.id, name: d.carrier.tradeName ?? d.carrier.legalName } : null,
          cnhCategory: d.cnhCategory,
          cnhExpiresAt: fromDate(d.cnhExpiresAt),
          cnhStatus: cnhStatus(d.cnhExpiresAt),
          status: d.status,
          updatedAt: d.updatedAt.toISOString(),
        })),
      };
    });
  }

  driverDetail(id: string) {
    return this.db.read(async (tx) => {
      const d = await tx.driver.findUnique({ where: { id }, include: { carrier: { select: { id: true, legalName: true, tradeName: true } } } });
      if (!d) throw AppError.notFound('Motorista não encontrado.');
      return { ...d, cnhExpiresAt: fromDate(d.cnhExpiresAt), carrier: d.carrier ? { id: d.carrier.id, name: d.carrier.tradeName ?? d.carrier.legalName } : null };
    });
  }

  saveDriver(id: string | null, input: DriverData) {
    const tenantId = currentAuth().membership!.tenantId;
    return this.db.write(async ({ tx, audit }) => {
      await assertCarrier(tx, input.carrierPartnerId);
      const dup = await tx.driver.findFirst({ where: { cpf: input.cpf, ...(id ? { id: { not: id } } : {}) }, select: { name: true } });
      if (dup) throw AppError.conflict(`CPF já cadastrado para ${dup.name}.`, ErrorCode.CONFLICT, { fields: { cpf: ['CPF em uso'] } });
      const data = {
        carrierPartnerId: input.carrierPartnerId ?? null,
        name: input.name,
        cpf: input.cpf,
        phone: input.phone ?? null,
        email: input.email ?? null,
        cnhNumber: input.cnhNumber ?? null,
        cnhCategory: input.cnhCategory ?? null,
        cnhExpiresAt: toDate(input.cnhExpiresAt),
        notes: input.notes ?? null,
        status: input.status,
      };
      const before = id ? await tx.driver.findUnique({ where: { id } }) : null;
      if (id && !before) throw AppError.notFound('Motorista não encontrado.');
      const saved = id ? await tx.driver.update({ where: { id }, data }) : await tx.driver.create({ data: { tenantId, ...data } });
      await audit({ entityType: 'driver', entityId: saved.id, action: id ? 'driver.updated' : 'driver.created', before, after: data });
      return { id: saved.id };
    });
  }

  // ───────────────────────────── Veículos ─────────────────────────────

  listVehicles(q: RegistryListQuery): Promise<Page<VehicleListItem>> {
    return this.db.read(async (tx) => {
      const plate = q.q?.toUpperCase().replace(/[^A-Z0-9]/g, '') ?? '';
      const where: Prisma.VehicleWhereInput = {
        ...(q.includeArchived ? {} : { archivedAt: null }),
        ...(q.status ? { status: q.status } : {}),
        ...(q.partnerId ? { carrierPartnerId: q.partnerId } : {}),
        ...(q.q ? { OR: [{ plate: { contains: plate || q.q } }, { brand: text(q.q) }, { model: text(q.q) }] } : {}),
      };
      const [total, rows] = await Promise.all([
        tx.vehicle.count({ where }),
        tx.vehicle.findMany({
          where,
          include: { carrier: { select: { id: true, legalName: true, tradeName: true } } },
          orderBy: { plate: 'asc' },
          skip: (q.page - 1) * q.pageSize,
          take: q.pageSize,
        }),
      ]);
      return {
        total,
        page: q.page,
        pageSize: q.pageSize,
        items: rows.map((v) => ({
          id: v.id,
          plate: v.plate,
          type: v.type,
          carrier: v.carrier ? { id: v.carrier.id, name: v.carrier.tradeName ?? v.carrier.legalName } : null,
          capacityKg: v.capacityKg?.toString() ?? null,
          axles: v.axles,
          brand: v.brand,
          model: v.model,
          year: v.year,
          renavam: v.renavam,
          notes: v.notes,
          status: v.status,
          updatedAt: v.updatedAt.toISOString(),
        })),
      };
    });
  }

  saveVehicle(id: string | null, input: VehicleData) {
    const tenantId = currentAuth().membership!.tenantId;
    return this.db.write(async ({ tx, audit }) => {
      await assertCarrier(tx, input.carrierPartnerId);
      const dup = await tx.vehicle.findFirst({ where: { plate: input.plate, ...(id ? { id: { not: id } } : {}) } });
      if (dup) throw AppError.conflict(`A placa ${input.plate} já está cadastrada.`, ErrorCode.CONFLICT, { fields: { plate: ['Placa em uso'] } });
      const data = {
        carrierPartnerId: input.carrierPartnerId ?? null,
        plate: input.plate,
        type: input.type,
        capacityKg: input.capacityKg ?? null,
        axles: input.axles ?? null,
        brand: input.brand ?? null,
        model: input.model ?? null,
        year: input.year ?? null,
        renavam: input.renavam ?? null,
        notes: input.notes ?? null,
        status: input.status,
      };
      const before = id ? await tx.vehicle.findUnique({ where: { id } }) : null;
      if (id && !before) throw AppError.notFound('Veículo não encontrado.');
      const saved = id ? await tx.vehicle.update({ where: { id }, data }) : await tx.vehicle.create({ data: { tenantId, ...data } });
      await audit({ entityType: 'vehicle', entityId: saved.id, action: id ? 'vehicle.updated' : 'vehicle.created', before, after: data });
      return { id: saved.id };
    });
  }

  setArchived(kind: 'driver' | 'vehicle', id: string, archived: boolean) {
    return this.db.write(async ({ tx, audit }) => {
      const data = { archivedAt: archived ? new Date() : null };
      const res = kind === 'driver' ? await tx.driver.updateMany({ where: { id }, data }) : await tx.vehicle.updateMany({ where: { id }, data });
      if (!res.count) throw AppError.notFound();
      await audit({ entityType: kind, entityId: id, action: `${kind}.${archived ? 'archived' : 'restored'}` });
    });
  }
}
