import { Injectable } from '@nestjs/common';
import type { CursorPage, LocationUsage, LookupOption } from '@ordens/contracts';
import { Prisma } from '@ordens/db';
import { AppError } from '../../common/errors.js';
import { TenantDb } from '../../infra/tenant-db.service.js';

export type PartnerLookupRole = 'SELLER' | 'BUYER' | 'CARRIER';

interface KeysetCursor {
  n: string;
  i: string;
}

const encodeCursor = (c: KeysetCursor) => Buffer.from(JSON.stringify(c)).toString('base64url');
function decodeCursor(raw?: string): KeysetCursor | null {
  if (!raw) return null;
  try {
    const c = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as KeysetCursor;
    return typeof c.n === 'string' && typeof c.i === 'string' ? c : null;
  } catch {
    throw AppError.validation({ fields: { cursor: ['Cursor inválido'] } });
  }
}

function maskDocument(doc: string): string {
  if (doc.length === 11) return `${doc.slice(0, 3)}.***.***-${doc.slice(9)}`;
  if (doc.length === 14) return `${doc.slice(0, 2)}.${doc.slice(2, 5)}.${doc.slice(5, 8)}/${doc.slice(8, 12)}-${doc.slice(12)}`;
  return doc;
}

const like = (q?: string) => (q ? `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%` : null);

/**
 * Consultas paginadas por keyset para comboboxes assíncronos.
 * Todas rodam sob RLS do contexto da sessão.
 */
@Injectable()
export class LookupsService {
  constructor(private readonly db: TenantDb) {}

  async partners(params: { role: PartnerLookupRole; q?: string; cursor?: string; limit: number; contractId?: string }): Promise<CursorPage<LookupOption>> {
    const cursor = decodeCursor(params.cursor);
    const pattern = like(params.q);
    const digits = params.q?.replace(/\D/g, '') ?? '';
    const docPattern = digits.length >= 3 ? `%${digits}%` : null;
    return this.db.read(async (tx) => {
      let restrictTo: string | null = null;
      if (params.contractId) {
        const contract = await tx.contract.findUnique({ where: { id: params.contractId } });
        if (!contract) throw AppError.notFound('Contrato não encontrado.');
        restrictTo = params.role === 'SELLER' ? contract.sellerPartnerId : params.role === 'BUYER' ? contract.buyerPartnerId : null;
      }
      const rows = await tx.$queryRaw<
        { id: string; legal_name: string; trade_name: string | null; document: string; city: string | null; state: string | null; farms: bigint }[]
      >(Prisma.sql`
        select p.id, p.legal_name, p.trade_name, p.document, p.city, p.state,
               (select count(*) from farms f where f.owner_partner_id = p.id and f.archived_at is null) as farms
        from business_partners p
        where p.archived_at is null and p.status = 'ACTIVE'
          and exists (select 1 from partner_roles r where r.partner_id = p.id and r.role = ${params.role}::partner_role)
          ${restrictTo ? Prisma.sql`and p.id = ${restrictTo}::uuid` : Prisma.empty}
          ${pattern ? Prisma.sql`and (p.legal_name ilike ${pattern} or p.trade_name ilike ${pattern}${docPattern ? Prisma.sql` or p.document like ${docPattern}` : Prisma.empty})` : Prisma.empty}
          ${cursor ? Prisma.sql`and (p.legal_name, p.id) > (${cursor.n}, ${cursor.i}::uuid)` : Prisma.empty}
        order by p.legal_name, p.id
        limit ${params.limit + 1}
      `);
      return this.page(rows, params.limit, (r) => ({
        id: r.id,
        label: r.trade_name ?? r.legal_name,
        description: [r.trade_name ? r.legal_name : null, maskDocument(r.document), r.city && r.state ? `${r.city}/${r.state}` : null]
          .filter(Boolean)
          .join(' · '),
        meta: { farms: String(r.farms) },
      }), (r) => ({ n: r.legal_name, i: r.id }));
    });
  }

  async farms(params: { sellerId: string; q?: string; cursor?: string; limit: number }): Promise<CursorPage<LookupOption>> {
    const cursor = decodeCursor(params.cursor);
    const pattern = like(params.q);
    return this.db.read(async (tx) => {
      const rows = await tx.$queryRaw<{ id: string; name: string; code: string | null; city: string | null; state: string | null; owner_partner_id: string }[]>(
        Prisma.sql`
          select f.id, f.name, f.code, f.city, f.state, f.owner_partner_id
          from farms f
          where f.owner_partner_id = ${params.sellerId}::uuid and f.archived_at is null and f.status = 'ACTIVE'
            ${pattern ? Prisma.sql`and (f.name ilike ${pattern} or f.code ilike ${pattern} or f.city ilike ${pattern})` : Prisma.empty}
            ${cursor ? Prisma.sql`and (f.name, f.id) > (${cursor.n}, ${cursor.i}::uuid)` : Prisma.empty}
          order by f.name, f.id
          limit ${params.limit + 1}
        `,
      );
      return this.page(rows, params.limit, (r) => ({
        id: r.id,
        label: r.name,
        description: [r.code, r.city && r.state ? `${r.city}/${r.state}` : null].filter(Boolean).join(' · '),
        meta: { sellerId: r.owner_partner_id, city: r.city, state: r.state },
      }), (r) => ({ n: r.name, i: r.id }));
    });
  }

  /** Locais ativos; com comprador, mostra primeiro os dele e depois os sem vínculo (Q39). */
  async locations(params: { buyerId?: string; usage?: LocationUsage; q?: string; cursor?: string; limit: number }): Promise<CursorPage<LookupOption>> {
    const cursor = decodeCursor(params.cursor);
    const pattern = like(params.q);
    return this.db.read(async (tx) => {
      const rows = await tx.$queryRaw<
        { id: string; name: string; kind: string; code: string | null; city: string | null; state: string | null; address: string | null; partner_id: string | null; sort_key: string }[]
      >(Prisma.sql`
        select l.id, l.name, l.kind::text as kind, l.code, l.city, l.state, l.address, l.partner_id,
          (case when ${params.buyerId ?? null}::uuid is not null and l.partner_id = ${params.buyerId ?? null}::uuid then '0' else '1' end) || lower(l.name) as sort_key
        from locations l
        where l.archived_at is null and l.status = 'ACTIVE'
          ${params.usage === 'LOADING' ? Prisma.sql`and l.usage in ('LOADING', 'BOTH')` : params.usage === 'DELIVERY' ? Prisma.sql`and l.usage in ('DELIVERY', 'BOTH')` : Prisma.empty}
          ${params.buyerId ? Prisma.sql`and (l.partner_id = ${params.buyerId}::uuid or l.partner_id is null)` : Prisma.empty}
          ${pattern ? Prisma.sql`and (l.name ilike ${pattern} or l.code ilike ${pattern} or l.city ilike ${pattern})` : Prisma.empty}
          ${cursor ? Prisma.sql`and ((case when ${params.buyerId ?? null}::uuid is not null and l.partner_id = ${params.buyerId ?? null}::uuid then '0' else '1' end) || lower(l.name), l.id) > (${cursor.n}, ${cursor.i}::uuid)` : Prisma.empty}
        order by sort_key, l.id
        limit ${params.limit + 1}
      `);
      return this.page(rows, params.limit, (r) => ({
        id: r.id,
        label: r.name,
        description: [r.code, r.city && r.state ? `${r.city}/${r.state}` : r.city, params.buyerId && r.partner_id === params.buyerId ? 'do comprador' : null].filter(Boolean).join(' · '),
        meta: { name: r.name, kind: r.kind, city: r.city, state: r.state, address: r.address },
      }), (r) => ({ n: r.sort_key, i: r.id }));
    });
  }

  async commodities(params: { q?: string; contractId?: string }): Promise<CursorPage<LookupOption>> {
    const pattern = like(params.q);
    return this.db.read(async (tx) => {
      let onlyId: string | null = null;
      if (params.contractId) {
        const c = await tx.contract.findUnique({ where: { id: params.contractId }, select: { commodityId: true } });
        if (!c) throw AppError.notFound('Contrato não encontrado.');
        onlyId = c.commodityId;
      }
      const rows = await tx.$queryRaw<{ id: string; name: string; code: string; category: string | null; unit_id: string | null; unit_code: string | null }[]>(
        Prisma.sql`
          select c.id, c.name, c.code, c.category, u.id as unit_id, u.code as unit_code
          from commodities c left join units u on u.id = c.default_unit_id
          where c.status = 'ACTIVE'
            ${onlyId ? Prisma.sql`and c.id = ${onlyId}::uuid` : Prisma.empty}
            ${pattern ? Prisma.sql`and (c.name ilike ${pattern} or c.code ilike ${pattern})` : Prisma.empty}
          order by c.name
          limit 100
        `,
      );
      return {
        items: rows.map((r) => ({ id: r.id, label: r.name, description: r.category ?? r.code, meta: { defaultUnitId: r.unit_id, defaultUnitCode: r.unit_code } })),
        nextCursor: null,
      };
    });
  }

  async units(): Promise<LookupOption[]> {
    return this.db.read(async (tx) => {
      const rows = await tx.unit.findMany({ orderBy: { factorToKg: 'asc' } });
      return rows.map((u) => ({ id: u.id, label: u.code === 'T' ? 't' : u.code === 'KG' ? 'kg' : u.code.toLowerCase(), description: u.name, meta: { factorToKg: u.factorToKg.toString(), code: u.code } }));
    });
  }

  async contracts(params: { q?: string; sellerId?: string; buyerId?: string; commodityId?: string; cursor?: string; limit: number }): Promise<CursorPage<LookupOption>> {
    const cursor = decodeCursor(params.cursor);
    const pattern = like(params.q);
    return this.db.read(async (tx) => {
      const rows = await tx.$queryRaw<
        {
          id: string;
          number: string;
          crop_year: string | null;
          quantity: Prisma.Decimal;
          committed: Prisma.Decimal;
          seller_id: string;
          seller: string;
          buyer_id: string;
          buyer: string;
          commodity_id: string;
          commodity: string;
          unit_id: string;
          unit_code: string;
          unit_price: Prisma.Decimal | null;
          currency: string;
          freight_mode: string | null;
        }[]
      >(Prisma.sql`
        select ct.id, ct.number, ct.crop_year, ct.quantity,
               coalesce((select sum(lo.quantity) from loading_orders lo
                          where lo.contract_id = ct.id and lo.status not in ('DRAFT', 'CANCELLED')), 0) as committed,
               s.id as seller_id, coalesce(s.trade_name, s.legal_name) as seller,
               b.id as buyer_id, coalesce(b.trade_name, b.legal_name) as buyer,
               c.id as commodity_id, c.name as commodity,
               u.id as unit_id, u.code as unit_code, ct.unit_price, ct.currency, ct.freight_mode::text as freight_mode
        from contracts ct
        join business_partners s on s.id = ct.seller_partner_id
        join business_partners b on b.id = ct.buyer_partner_id
        join commodities c on c.id = ct.commodity_id
        join units u on u.id = ct.unit_id
        where ct.status = 'ACTIVE'
          ${params.sellerId ? Prisma.sql`and ct.seller_partner_id = ${params.sellerId}::uuid` : Prisma.empty}
          ${params.buyerId ? Prisma.sql`and ct.buyer_partner_id = ${params.buyerId}::uuid` : Prisma.empty}
          ${params.commodityId ? Prisma.sql`and ct.commodity_id = ${params.commodityId}::uuid` : Prisma.empty}
          ${pattern ? Prisma.sql`and (ct.number ilike ${pattern} or s.legal_name ilike ${pattern} or b.legal_name ilike ${pattern} or c.name ilike ${pattern})` : Prisma.empty}
          ${cursor ? Prisma.sql`and (ct.number, ct.id) > (${cursor.n}, ${cursor.i}::uuid)` : Prisma.empty}
        order by ct.number, ct.id
        limit ${params.limit + 1}
      `);
      return this.page(rows, params.limit, (r) => ({
        id: r.id,
        label: r.number,
        description: `${r.seller} → ${r.buyer} · ${r.commodity}${r.crop_year ? ` ${r.crop_year}` : ''}`,
        meta: {
          sellerId: r.seller_id,
          sellerName: r.seller,
          buyerId: r.buyer_id,
          buyerName: r.buyer,
          commodityId: r.commodity_id,
          commodityName: r.commodity,
          unitId: r.unit_id,
          unitCode: r.unit_code,
          unitPrice: r.unit_price?.toString() ?? null,
          currency: r.currency,
          freightMode: r.freight_mode,
          cropYear: r.crop_year,
          quantity: r.quantity.toString(),
          balance: r.quantity.minus(r.committed).toString(),
        },
      }), (r) => ({ n: r.number, i: r.id }));
    });
  }

  private page<R, T>(rows: R[], limit: number, map: (r: R) => T, key: (r: R) => KeysetCursor): CursorPage<T> {
    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit);
    const last = items[items.length - 1];
    return { items: items.map(map), nextCursor: hasMore && last ? encodeCursor(key(last)) : null };
  }
}
