import { Injectable } from '@nestjs/common';
import { commodityInputSchema, ErrorCode, type CommodityListItem, type Page, type RegistryListQuery } from '@ordens/contracts';
import { Prisma } from '@ordens/db';
import type { z } from 'zod';
import { AppError } from '../../common/errors.js';
import { currentAuth } from '../../common/request-context.js';
import { TenantDb } from '../../infra/tenant-db.service.js';

type CommodityData = z.output<typeof commodityInputSchema>;

const text = (q?: string) => (q ? { contains: q, mode: 'insensitive' as const } : undefined);

/** Commodities: cadastro de estrutura simples. */
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
}
