import { Injectable } from '@nestjs/common';
import type { CursorPage, LookupOption } from '@ordens/contracts';
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

  async partners(params: { role: PartnerLookupRole; q?: string; cursor?: string; limit: number }): Promise<CursorPage<LookupOption>> {
    const cursor = decodeCursor(params.cursor);
    const pattern = like(params.q);
    const digits = params.q?.replace(/\D/g, '') ?? '';
    const docPattern = digits.length >= 3 ? `%${digits}%` : null;
    return this.db.read(async (tx) => {
      const rows = await tx.$queryRaw<
        { id: string; legal_name: string; trade_name: string | null; document: string; city: string | null; state: string | null; farms: bigint }[]
      >(Prisma.sql`
        select p.id, p.legal_name, p.trade_name, p.document, p.city, p.state,
               (select count(*) from farms f where f.owner_partner_id = p.id and f.archived_at is null) as farms
        from business_partners p
        where p.archived_at is null and p.status = 'ACTIVE'
          and exists (select 1 from partner_roles r where r.partner_id = p.id and r.role = ${params.role}::partner_role)
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

  async commodities(params: { q?: string }): Promise<CursorPage<LookupOption>> {
    const pattern = like(params.q);
    return this.db.read(async (tx) => {
      const rows = await tx.$queryRaw<{ id: string; name: string; code: string; category: string | null; unit_id: string | null; unit_code: string | null }[]>(
        Prisma.sql`
          select c.id, c.name, c.code, c.category, u.id as unit_id, u.code as unit_code
          from commodities c left join units u on u.id = c.default_unit_id
          where c.status = 'ACTIVE'
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

  /**
   * Números de contrato já digitados nas ordens visíveis a quem pergunta. Não há cadastro de
   * contratos: o número é uma referência comercial que o Faturamento escreve, e a sugestão existe
   * só para evitar que o mesmo contrato apareça escrito de formas diferentes. Como a leitura passa
   * pelo RLS, cada grupo só recebe o que é dele.
   */
  async contractNumbers(params: { q?: string }): Promise<CursorPage<LookupOption>> {
    const pattern = like(params.q);
    return this.db.read(async (tx) => {
      const rows = await tx.$queryRaw<{ contract_number: string }[]>(Prisma.sql`
        select distinct contract_number
        from loading_orders
        where contract_number is not null
          ${pattern ? Prisma.sql`and contract_number ilike ${pattern}` : Prisma.empty}
        order by contract_number
        limit 50
      `);
      return { nextCursor: null, items: rows.map((r) => ({ id: r.contract_number, label: r.contract_number })) };
    });
  }

  private page<R, T>(rows: R[], limit: number, map: (r: R) => T, key: (r: R) => KeysetCursor): CursorPage<T> {
    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit);
    const last = items[items.length - 1];
    return { items: items.map(map), nextCursor: hasMore && last ? encodeCursor(key(last)) : null };
  }
}
