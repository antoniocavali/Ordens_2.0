/**
 * Testes de isolamento RLS. Executam com DATABASE_URL = role ordens_app (sem BYPASSRLS).
 * Critério de conclusão das Fases 1–2 (docs/multi-tenancy.md).
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Database } from './client.js';
import { systemContext, type DbContext } from './context.js';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL (ordens_app) é obrigatório para testes de integração');

const db = new Database({ connectionString: url, poolMax: 4, applicationName: 'ordens-rls-test' });

interface TenantFixture {
  tenantId: string;
  matrizOrg: string;
  farmOrgs: [string, string];
  buyerOrgs: [string, string];
  sellers: [string, string];
  buyers: [string, string];
  farms: [string, string];
  commodity: string;
  unit: string;
  /** ordens[i] publicada da fazenda i; draft da fazenda 0. */
  published: [string, string];
  draft: string;
}

const matriz = (f: TenantFixture): DbContext => ({ tenantId: f.tenantId, userId: randomUUID(), membershipId: randomUUID(), scope: 'MATRIZ', orgIds: [f.matrizOrg] });
const farm = (f: TenantFixture, i: 0 | 1): DbContext => ({ tenantId: f.tenantId, userId: randomUUID(), membershipId: randomUUID(), scope: 'FARM', orgIds: [f.farmOrgs[i]] });
const buyer = (f: TenantFixture, i: 0 | 1): DbContext => ({ tenantId: f.tenantId, userId: randomUUID(), membershipId: randomUUID(), scope: 'BUYER', orgIds: [f.buyerOrgs[i]] });

async function createTenant(label: string): Promise<TenantFixture> {
  const tenantId = randomUUID();
  const suffix = randomUUID().slice(0, 8);
  return db.run(systemContext(tenantId), async (tx) => {
    await tx.tenant.create({ data: { id: tenantId, slug: `rls-${label}-${suffix}`, name: `RLS ${label}` } });
    const unit = await tx.unit.create({ data: { tenantId, code: 'T', name: 'Tonelada', factorToKg: '1000' } });
    const commodity = await tx.commodity.create({ data: { tenantId, code: 'MILHO', name: 'Milho' } });
    const partner = async (name: string, role: 'SELLER' | 'BUYER') => {
      const p = await tx.businessPartner.create({ data: { tenantId, personType: 'PJ', legalName: `${name} ${suffix}`, document: randomUUID().replace(/\D/g, '').slice(0, 14).padEnd(14, '0') } });
      await tx.partnerRoleAssignment.create({ data: { partnerId: p.id, role, tenantId } });
      return p.id;
    };
    const sellers: [string, string] = [await partner('Vendedor A', 'SELLER'), await partner('Vendedor B', 'SELLER')];
    const buyers: [string, string] = [await partner('Comprador A', 'BUYER'), await partner('Comprador B', 'BUYER')];
    const matrizOrg = (await tx.organization.create({ data: { tenantId, kind: 'MATRIZ', name: 'Matriz' } })).id;
    const farmOrgs: [string, string] = [
      (await tx.organization.create({ data: { tenantId, kind: 'FARM', name: 'Fazenda org A', partnerId: sellers[0] } })).id,
      (await tx.organization.create({ data: { tenantId, kind: 'FARM', name: 'Fazenda org B', partnerId: sellers[1] } })).id,
    ];
    const buyerOrgs: [string, string] = [
      (await tx.organization.create({ data: { tenantId, kind: 'BUYER', name: 'Comprador org A', partnerId: buyers[0] } })).id,
      (await tx.organization.create({ data: { tenantId, kind: 'BUYER', name: 'Comprador org B', partnerId: buyers[1] } })).id,
    ];
    const farms: [string, string] = [
      (await tx.farm.create({ data: { tenantId, ownerPartnerId: sellers[0], organizationId: farmOrgs[0], name: 'Fazenda A' } })).id,
      (await tx.farm.create({ data: { tenantId, ownerPartnerId: sellers[1], organizationId: farmOrgs[1], name: 'Fazenda B' } })).id,
    ];
    const order = (i: 0 | 1, status: 'DRAFT' | 'PUBLISHED', n: string) =>
      tx.loadingOrder.create({
        data: {
          tenantId,
          number: n,
          status,
          version: status === 'DRAFT' ? 0 : 1,
          sellerPartnerId: sellers[i],
          farmId: farms[i],
          buyerPartnerId: buyers[i],
          commodityId: commodity.id,
          unitId: unit.id,
          quantity: '100',
        },
      });
    const published: [string, string] = [(await order(0, 'PUBLISHED', `P-A-${suffix}`)).id, (await order(1, 'PUBLISHED', `P-B-${suffix}`)).id];
    const draft = (await order(0, 'DRAFT', `D-A-${suffix}`)).id;
    return { tenantId, matrizOrg, farmOrgs, buyerOrgs, sellers, buyers, farms, commodity: commodity.id, unit: unit.id, published, draft };
  });
}

let A: TenantFixture;
let B: TenantFixture;

beforeAll(async () => {
  A = await createTenant('a');
  B = await createTenant('b');
});

afterAll(async () => {
  await db.disconnect();
});

describe('role de runtime', () => {
  it('conecta como role sem superuser e sem BYPASSRLS', async () => {
    const [role] = await db.prisma.$queryRaw<{ rolname: string; rolsuper: boolean; rolbypassrls: boolean }[]>`
      select rolname, rolsuper, rolbypassrls from pg_roles where rolname = current_user`;
    expect(role?.rolsuper).toBe(false);
    expect(role?.rolbypassrls).toBe(false);
  });
});

describe('isolamento entre tenants', () => {
  it('sem contexto nenhuma linha é visível (fail closed)', async () => {
    const count = await db.prisma.loadingOrder.count();
    expect(count).toBe(0);
  });

  it('Matriz do tenant A não lê dados do tenant B, mesmo sem WHERE', async () => {
    const ids = await db.run(matriz(A), async (tx) => (await tx.loadingOrder.findMany({ select: { id: true } })).map((o) => o.id));
    expect(ids).toEqual(expect.arrayContaining([...A.published, A.draft]));
    expect(ids).not.toContain(B.published[0]);
    const partners = await db.run(matriz(A), (tx) => tx.businessPartner.findMany({ where: { id: { in: B.sellers } } }));
    expect(partners).toHaveLength(0);
  });

  it('Matriz do tenant A não grava no tenant B', async () => {
    await expect(
      db.run(matriz(A), (tx) =>
        tx.commodity.create({ data: { tenantId: B.tenantId, code: `X${randomUUID().slice(0, 4)}`, name: 'Invasão' } }),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it('Matriz do tenant A não altera OC do tenant B', async () => {
    const res = await db.run(matriz(A), (tx) => tx.loadingOrder.updateMany({ where: { id: B.published[0] }, data: { internalNotes: 'x' } }));
    expect(res.count).toBe(0);
  });
});

describe('isolamento entre organizações do mesmo tenant', () => {
  it('Fazenda A vê apenas suas OCs publicadas (nem rascunho, nem Fazenda B)', async () => {
    const ids = await db.run(farm(A, 0), async (tx) => (await tx.loadingOrder.findMany({ select: { id: true } })).map((o) => o.id));
    expect(ids).toEqual([A.published[0]]);
  });

  it('Fazenda B não enxerga a fazenda nem a OC da Fazenda A', async () => {
    const [orders, farms] = await db.run(farm(A, 1), (tx) =>
      Promise.all([tx.loadingOrder.findMany({ where: { id: A.published[0] } }), tx.farm.findMany({ where: { id: A.farms[0] } })]),
    );
    expect(orders).toHaveLength(0);
    expect(farms).toHaveLength(0);
  });

  it('Comprador A vê apenas as próprias OCs publicadas', async () => {
    const ids = await db.run(buyer(A, 0), async (tx) => (await tx.loadingOrder.findMany({ select: { id: true } })).map((o) => o.id));
    expect(ids).toEqual([A.published[0]]);
    const other = await db.run(buyer(A, 1), (tx) => tx.loadingOrder.findMany({ where: { id: A.published[0] } }));
    expect(other).toHaveLength(0);
  });

  it('Fazenda não consegue criar OC (RLS)', async () => {
    await expect(
      db.run(farm(A, 0), (tx) =>
        tx.loadingOrder.create({ data: { tenantId: A.tenantId, number: `F-${randomUUID().slice(0, 6)}`, sellerPartnerId: A.sellers[0], farmId: A.farms[0] } }),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it('Comprador não consegue criar nem alterar OC (RLS)', async () => {
    await expect(
      db.run(buyer(A, 0), (tx) => tx.loadingOrder.create({ data: { tenantId: A.tenantId, number: `C-${randomUUID().slice(0, 6)}` } })),
    ).rejects.toThrow(/row-level security/);
    const res = await db.run(buyer(A, 0), (tx) => tx.loadingOrder.updateMany({ where: { id: A.published[0] }, data: { quantity: '1' } }));
    expect(res.count).toBe(0);
  });

  it('Fazenda não registra visualização em nome de outra organização', async () => {
    const ctx = farm(A, 0);
    await expect(
      db.run(ctx, (tx) =>
        tx.loadingOrderView.create({
          data: { tenantId: A.tenantId, orderId: A.published[0], organizationId: A.farmOrgs[1], side: 'FARM', userId: ctx.userId!, membershipId: ctx.membershipId!, version: 1 },
        }),
      ),
    ).rejects.toThrow(/row-level security/);
  });
});

describe('integridade', () => {
  it('rejeita fazenda que não pertence ao vendedor (trigger)', async () => {
    await expect(
      db.run(matriz(A), (tx) =>
        tx.loadingOrder.create({ data: { tenantId: A.tenantId, number: `T-${randomUUID().slice(0, 6)}`, sellerPartnerId: A.sellers[1], farmId: A.farms[0] } }),
      ),
    ).rejects.toThrow(/não pertence ao vendedor/);
  });

  it('deriva seller_org_id e buyer_org_id', async () => {
    const o = await db.run(matriz(A), (tx) => tx.loadingOrder.findUniqueOrThrow({ where: { id: A.published[1] } }));
    expect(o.sellerOrgId).toBe(A.farmOrgs[1]);
    expect(o.buyerOrgId).toBe(A.buyerOrgs[1]);
  });
});

describe('auditoria append-only', () => {
  it('não permite UPDATE nem DELETE em audit_events', async () => {
    const created = await db.run(matriz(A), (tx) =>
      tx.auditEvent.create({ data: { tenantId: A.tenantId, entityType: 'test', action: 'test.created' } }),
    );
    await expect(
      db.run(matriz(A), (tx) => tx.$executeRaw`update audit_events set action = 'x' where id = ${created.id}`),
    ).rejects.toThrow(/permission denied|append-only/);
    await expect(
      db.run(matriz(A), (tx) => tx.$executeRaw`delete from audit_events where id = ${created.id}`),
    ).rejects.toThrow(/permission denied|append-only/);
  });

  it('Matriz grava outbox e auditoria sem precisar lê-las (sem RETURNING)', async () => {
    const { writeAudit, writeOutbox, EMPTY_META } = await import('./unit-of-work.js');
    const ctx = matriz(A);
    await db.run(ctx, async (tx) => {
      await writeOutbox(tx, ctx, EMPTY_META, { type: 'test.event', aggregateType: 'test', payload: { ok: true } });
      await writeAudit(tx, ctx, EMPTY_META, { entityType: 'file_upload', action: 'upload.initiated' });
    });
    const visible = await db.run(ctx, (tx) => tx.outboxEvent.count());
    expect(visible).toBe(0);
  });

  it('falha na auditoria desfaz a alteração de domínio (mesma transação)', async () => {
    const name = `Rollback ${randomUUID().slice(0, 6)}`;
    await expect(
      db.run(matriz(A), async (tx) => {
        await tx.commodity.create({ data: { tenantId: A.tenantId, code: name, name } });
        // Auditoria inválida (tenant de outro) → violação de RLS → rollback de tudo.
        await tx.auditEvent.create({ data: { tenantId: B.tenantId, entityType: 'commodity', action: 'commodity.created' } });
      }),
    ).rejects.toThrow();
    const found = await db.run(matriz(A), (tx) => tx.commodity.findFirst({ where: { name } }));
    expect(found).toBeNull();
  });
});
