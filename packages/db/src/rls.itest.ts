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

describe('cadastros', () => {
  const partnersWithRoles = (ctx: DbContext) =>
    db.run(ctx, (tx) =>
      tx.$queryRaw<{ id: string; roles: string[] }[]>`
        select p.id, array(select r.role::text from partner_roles r where r.partner_id = p.id) as roles
        from business_partners p`,
    );

  it('listagem de parceiros com papéis não entra em recursão de políticas (Matriz e Fazenda)', async () => {
    const internal = await partnersWithRoles(matriz(A));
    expect(internal.length).toBeGreaterThanOrEqual(4);
    const external = await partnersWithRoles(farm(A, 0));
    expect(external.map((p) => p.id)).toContain(A.sellers[0]);
    expect(external.map((p) => p.id)).not.toContain(A.sellers[1]);
  });

  it('Fazenda não altera papéis de parceiros', async () => {
    await expect(
      db.run(farm(A, 0), (tx) => tx.partnerRoleAssignment.create({ data: { partnerId: A.sellers[0], role: 'CARRIER', tenantId: A.tenantId } })),
    ).rejects.toThrow(/row-level security/);
  });

  it('Comprador não lê motoristas nem veículos', async () => {
    const drivers = await db.run(buyer(A, 0), (tx) => tx.driver.findMany());
    expect(drivers).toHaveLength(0);
  });
});

describe('logística', () => {
  const appointmentData = (f: TenantFixture) => ({ tenantId: f.tenantId, orderId: f.published[0], scheduledOn: new Date('2026-09-20T00:00:00Z'), expectedQty: '30' });

  it('Fazenda da ordem cria agendamento; organizações são herdadas da ordem', async () => {
    const a = await db.run(farm(A, 0), (tx) => tx.appointment.create({ data: appointmentData(A) }));
    const read = await db.run(matriz(A), (tx) => tx.appointment.findUniqueOrThrow({ where: { id: a.id } }));
    expect(read.sellerOrgId).toBe(A.farmOrgs[0]);
    expect(read.buyerOrgId).toBe(A.buyerOrgs[0]);
  });

  it('outra Fazenda e o Comprador não criam agendamento', async () => {
    // Negado pelo RLS ou, antes dele, pelo trigger (que também não enxerga a ordem de outra organização).
    const denied = /row-level security|Ordem inexistente/;
    await expect(db.run(farm(A, 1), (tx) => tx.appointment.create({ data: appointmentData(A) }))).rejects.toThrow(denied);
    await expect(db.run(buyer(A, 0), (tx) => tx.appointment.create({ data: appointmentData(A) }))).rejects.toThrow(denied);
  });

  it('Comprador lê cargas da própria ordem, mas não de outra', async () => {
    const load = await db.run(matriz(A), (tx) =>
      tx.load.create({ data: { tenantId: A.tenantId, orderId: A.published[0], number: `L-${randomUUID().slice(0, 6)}`, sequence: 1, expectedQty: '30' } }),
    );
    const own = await db.run(buyer(A, 0), (tx) => tx.load.findMany({ where: { id: load.id } }));
    expect(own).toHaveLength(1);
    const other = await db.run(buyer(A, 1), (tx) => tx.load.findMany({ where: { id: load.id } }));
    expect(other).toHaveLength(0);
  });

  it('Fazenda recalcula totais, mas não altera campos comerciais da ordem', async () => {
    await db.run(farm(A, 0), (tx) => tx.$executeRaw`select recalc_order_quantities(${A.published[0]}::uuid)`);
    // Regressão: o recálculo sob RLS da Fazenda não pode apagar a organização do Comprador (ela não a enxerga).
    const order = await db.run(matriz(A), (tx) => tx.loadingOrder.findUniqueOrThrow({ where: { id: A.published[0] } }));
    expect(order.sellerOrgId).toBe(A.farmOrgs[0]);
    expect(order.buyerOrgId).toBe(A.buyerOrgs[0]);
    await expect(
      db.run(farm(A, 0), (tx) => tx.loadingOrder.update({ where: { id: A.published[0] }, data: { quantity: '999' } })),
    ).rejects.toThrow(/totais operacionais|42501|permission/i);
  });
});

describe('fiscal, ocorrências e documentos', () => {
  let sequence = 100;
  const digits = (n: number) => Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join('');
  const newLoad = (f: TenantFixture, i: 0 | 1) =>
    db.run(matriz(f), (tx) =>
      tx.load.create({ data: { tenantId: f.tenantId, orderId: f.published[i], number: `F-${randomUUID().slice(0, 8)}`, sequence: sequence++, expectedQty: '30' } }),
    );
  const invoiceData = (f: TenantFixture, loadId: string, status: 'VALID' | 'REJECTED' = 'VALID') => ({
    tenantId: f.tenantId,
    loadId,
    orderId: f.published[0],
    origin: 'FARM' as const,
    status,
    accessKey: status === 'REJECTED' ? null : digits(44),
    number: status === 'REJECTED' ? null : '1',
  });
  const occurrenceData = (f: TenantFixture, visibility: 'INTERNAL' | 'FARM' | 'BUYER' | 'PARTIES') => ({
    tenantId: f.tenantId,
    orderId: f.published[0],
    number: `OCR-${randomUUID().slice(0, 8)}`,
    type: 'QUALITY' as const,
    title: `Teste ${visibility}`,
    visibility,
  });

  it('Fazenda e Comprador não inserem NF-e diretamente', async () => {
    const load = await newLoad(A, 0);
    await expect(db.run(farm(A, 0), (tx) => tx.invoice.create({ data: invoiceData(A, load.id) }))).rejects.toThrow(/row-level security/);
    await expect(db.run(buyer(A, 0), (tx) => tx.invoice.create({ data: invoiceData(A, load.id) }))).rejects.toThrow(/row-level security/);
  });

  it('Comprador lê só NF-e válidas da própria ordem; Fazenda lê as da própria organização', async () => {
    const load = await newLoad(A, 0);
    const valid = await db.run(systemContext(A.tenantId), (tx) => tx.invoice.create({ data: invoiceData(A, load.id) }));
    const rejected = await db.run(systemContext(A.tenantId), (tx) => tx.invoice.create({ data: invoiceData(A, load.id, 'REJECTED') }));
    const ids = async (ctx: DbContext) => (await db.run(ctx, (tx) => tx.invoice.findMany({ where: { loadId: load.id }, select: { id: true } }))).map((r) => r.id);
    expect(await ids(buyer(A, 0))).toEqual([valid.id]);
    expect(await ids(farm(A, 0))).toEqual(expect.arrayContaining([valid.id, rejected.id]));
    expect(await ids(farm(A, 1))).toHaveLength(0);
    expect(await ids(buyer(A, 1))).toHaveLength(0);
    expect(await ids(matriz(B))).toHaveLength(0);
  });

  it('Fazenda só cancela a própria NF-e e ninguém apaga', async () => {
    const load = await newLoad(A, 0);
    const invoice = await db.run(systemContext(A.tenantId), (tx) => tx.invoice.create({ data: invoiceData(A, load.id) }));
    await expect(db.run(farm(A, 0), (tx) => tx.invoice.update({ where: { id: invoice.id }, data: { number: '999' } }))).rejects.toThrow(/Fazenda só pode cancelar/);
    const cancelled = await db.run(farm(A, 0), (tx) => tx.invoice.update({ where: { id: invoice.id }, data: { status: 'CANCELLED', cancelReason: 'erro' } }));
    expect(cancelled.status).toBe('CANCELLED');
    await expect(db.run(matriz(A), (tx) => tx.$executeRaw`delete from invoices where id = ${invoice.id}::uuid`)).rejects.toThrow(/permission denied/);
  });

  it('ocorrências respeitam a visibilidade para Fazenda e Comprador', async () => {
    const created = await db.run(matriz(A), async (tx) => ({
      internal: await tx.occurrence.create({ data: occurrenceData(A, 'INTERNAL') }),
      farm: await tx.occurrence.create({ data: occurrenceData(A, 'FARM') }),
      parties: await tx.occurrence.create({ data: occurrenceData(A, 'PARTIES') }),
    }));
    const all = [created.internal.id, created.farm.id, created.parties.id];
    const ids = async (ctx: DbContext) => (await db.run(ctx, (tx) => tx.occurrence.findMany({ where: { id: { in: all } }, select: { id: true } }))).map((r) => r.id).sort();
    expect(await ids(farm(A, 0))).toEqual([created.farm.id, created.parties.id].sort());
    expect(await ids(buyer(A, 0))).toEqual([created.parties.id]);
    expect(await ids(farm(A, 1))).toHaveLength(0);
  });

  it('Fazenda abre ocorrência visível a ela, mas não interna e não a encerra; Comprador não abre', async () => {
    await expect(db.run(farm(A, 0), (tx) => tx.occurrence.create({ data: occurrenceData(A, 'INTERNAL') }))).rejects.toThrow(/row-level security/);
    const own = await db.run(farm(A, 0), (tx) => tx.occurrence.create({ data: occurrenceData(A, 'FARM') }));
    await expect(
      db.run(farm(A, 0), (tx) => tx.occurrence.update({ where: { id: own.id }, data: { status: 'RESOLVED', resolution: 'ok' } })),
    ).rejects.toThrow(/Somente a Matriz/);
    await expect(db.run(buyer(A, 0), (tx) => tx.occurrence.create({ data: occurrenceData(A, 'PARTIES') }))).rejects.toThrow(/row-level security|Ordem inexistente/);
  });

  it('documentos compartilhados aparecem só para as partes da ordem', async () => {
    const upload = (visibility: 'INTERNAL' | 'PARTIES') => ({
      tenantId: A.tenantId,
      organizationId: A.matrizOrg,
      entityType: 'loading_order',
      entityId: A.published[0],
      kind: 'PDF' as const,
      originalName: `${visibility}.pdf`,
      declaredMime: 'application/pdf',
      sizeBytes: 10n,
      bucket: 'ordens-documents',
      objectKey: `t/${A.tenantId}/test/${randomUUID()}`,
      idempotencyKey: randomUUID(),
      createdBy: randomUUID(),
      status: 'AVAILABLE' as const,
      visibility,
    });
    const docs = await db.run(matriz(A), async (tx) => ({
      internal: await tx.fileUpload.create({ data: upload('INTERNAL') }),
      parties: await tx.fileUpload.create({ data: upload('PARTIES') }),
    }));
    expect(docs.parties.sellerOrgId).toBe(A.farmOrgs[0]);
    const ids = async (ctx: DbContext) =>
      (await db.run(ctx, (tx) => tx.fileUpload.findMany({ where: { id: { in: [docs.internal.id, docs.parties.id] } }, select: { id: true } }))).map((r) => r.id);
    expect(await ids(buyer(A, 0))).toEqual([docs.parties.id]);
    expect(await ids(farm(A, 0))).toEqual([docs.parties.id]);
    expect(await ids(farm(A, 1))).toHaveLength(0);
    expect(await ids(buyer(A, 1))).toHaveLength(0);
  });
});

describe('usuários (convite)', () => {
  it('Fazenda cria usuário novo e acesso só na própria organização, sem deixar usuário órfão', async () => {
    const invited = randomUUID();
    await db.run(farm(A, 0), async (tx) => {
      // Mesmo caminho da API: insert sem RETURNING (o convidado só fica visível após a membership).
      await tx.$executeRaw`insert into users (id, email, name, updated_at) values (${invited}::uuid, ${`rls-convite-${invited}@teste.local`}, 'Convidado', now())`;
      await tx.membership.create({ data: { tenantId: A.tenantId, userId: invited, organizationId: A.farmOrgs[0]!, scope: 'FARM' } });
    });
    expect(await db.run(farm(A, 0), (tx) => tx.user.findMany({ where: { id: invited } }))).toHaveLength(1);
    expect(await db.run(farm(A, 1), (tx) => tx.membership.findMany({ where: { userId: invited } }))).toHaveLength(0);

    const outsider = randomUUID();
    await expect(
      db.run(farm(A, 0), async (tx) => {
        await tx.$executeRaw`insert into users (id, email, name, updated_at) values (${outsider}::uuid, ${`rls-convite-${outsider}@teste.local`}, 'Fora', now())`;
        await tx.membership.create({ data: { tenantId: A.tenantId, userId: outsider, organizationId: A.farmOrgs[1]!, scope: 'FARM' } });
      }),
    ).rejects.toThrow();
    expect(await db.system((tx) => tx.user.findMany({ where: { id: outsider } }))).toHaveLength(0);
  });
});

describe('atendimento (chat)', () => {
  const people = async () =>
    db.system((tx) =>
      Promise.all(
        ['cliente', 'outro', 'atendente'].map((label) => tx.user.create({ data: { email: `rls-${label}-${randomUUID()}@teste.local`, name: `RLS ${label}` } })),
      ),
    );
  const conversationData = (f: TenantFixture, requesterUserId: string) => ({
    tenantId: f.tenantId,
    number: `ATD-${randomUUID().slice(0, 8)}`,
    requesterUserId,
    requesterOrgId: f.farmOrgs[0],
  });

  it('cliente só enxerga as próprias conversas; notas internas ficam com a equipe', async () => {
    const [cliente, outro] = await people();
    const asCliente = { ...farm(A, 0), userId: cliente!.id };
    const asOutro = { ...farm(A, 0), userId: outro!.id };
    const conv = await db.run(asCliente, (tx) => tx.supportConversation.create({ data: conversationData(A, cliente!.id) }));
    await db.run(asCliente, (tx) => tx.supportMessage.create({ data: { tenantId: A.tenantId, conversationId: conv.id, authorType: 'CUSTOMER', authorUserId: cliente!.id, body: 'Preciso de ajuda' } }));
    await db.run(matriz(A), (tx) => tx.supportMessage.create({ data: { tenantId: A.tenantId, conversationId: conv.id, authorType: 'AGENT', authorUserId: cliente!.id, body: 'Nota interna', internal: true } }));

    expect(await db.run(asOutro, (tx) => tx.supportConversation.findMany({ where: { id: conv.id } }))).toHaveLength(0);
    expect(await db.run(asOutro, (tx) => tx.supportMessage.findMany({ where: { conversationId: conv.id } }))).toHaveLength(0);
    const seenByCliente = await db.run(asCliente, (tx) => tx.supportMessage.findMany({ where: { conversationId: conv.id } }));
    expect(seenByCliente.map((m) => m.body)).toEqual(['Preciso de ajuda']);
    const seenByMatriz = await db.run(matriz(A), (tx) => tx.supportMessage.findMany({ where: { conversationId: conv.id } }));
    expect(seenByMatriz).toHaveLength(2);
    expect(await db.run(matriz(B), (tx) => tx.supportConversation.findMany({ where: { id: conv.id } }))).toHaveLength(0);
  });

  it('cliente não grava nota interna, mensagem de atendente nem em conversa alheia', async () => {
    const [cliente, outro] = await people();
    const asCliente = { ...farm(A, 0), userId: cliente!.id };
    const asOutro = { ...farm(A, 0), userId: outro!.id };
    const conv = await db.run(asCliente, (tx) => tx.supportConversation.create({ data: conversationData(A, cliente!.id) }));
    const base = { tenantId: A.tenantId, conversationId: conv.id, body: 'x' };
    await expect(db.run(asCliente, (tx) => tx.supportMessage.create({ data: { ...base, authorType: 'AGENT', authorUserId: cliente!.id } }))).rejects.toThrow(/row-level security/);
    await expect(db.run(asCliente, (tx) => tx.supportMessage.create({ data: { ...base, authorType: 'AGENT', authorUserId: cliente!.id, internal: true } }))).rejects.toThrow(/row-level security/);
    await expect(db.run(asOutro, (tx) => tx.supportMessage.create({ data: { ...base, authorType: 'CUSTOMER', authorUserId: outro!.id } }))).rejects.toThrow(/row-level security/);
    await expect(db.run(asOutro, (tx) => tx.supportConversation.create({ data: conversationData(A, cliente!.id) }))).rejects.toThrow(/row-level security/);
  });

  it('cliente não altera responsável nem status fora do fluxo; pode encerrar', async () => {
    const [cliente, , atendente] = await people();
    const asCliente = { ...farm(A, 0), userId: cliente!.id };
    const conv = await db.run(asCliente, (tx) => tx.supportConversation.create({ data: conversationData(A, cliente!.id) }));
    await expect(db.run(asCliente, (tx) => tx.supportConversation.update({ where: { id: conv.id }, data: { assigneeUserId: atendente!.id } }))).rejects.toThrow(/apenas ao atendimento/);
    await expect(db.run(asCliente, (tx) => tx.supportConversation.update({ where: { id: conv.id }, data: { priority: 'URGENT' } }))).rejects.toThrow(/apenas ao atendimento/);
    await expect(db.run(asCliente, (tx) => tx.supportConversation.update({ where: { id: conv.id }, data: { status: 'RESOLVED' } }))).rejects.toThrow(/apenas ao atendimento/);
    const queued = await db.run(asCliente, (tx) => tx.supportConversation.update({ where: { id: conv.id }, data: { queue: 'BILLING', status: 'WAITING' } }));
    expect(queued.status).toBe('WAITING');
    const assigned = await db.run(matriz(A), (tx) => tx.supportConversation.update({ where: { id: conv.id }, data: { assigneeUserId: atendente!.id, status: 'OPEN' } }));
    expect(assigned.assigneeUserId).toBe(atendente!.id);
    const closed = await db.run(asCliente, (tx) => tx.supportConversation.update({ where: { id: conv.id }, data: { status: 'CLOSED' } }));
    expect(closed.status).toBe('CLOSED');
  });

  it('cliente não reabre conversa resolvida; pode encerrar', async () => {
    const [cliente] = await people();
    const asCliente = { ...farm(A, 0), userId: cliente!.id };
    const conv = await db.run(asCliente, (tx) => tx.supportConversation.create({ data: { ...conversationData(A, cliente!.id), queue: 'SUPPORT', status: 'WAITING' } }));
    await db.run(matriz(A), (tx) => tx.supportConversation.update({ where: { id: conv.id }, data: { status: 'RESOLVED' } }));
    await expect(db.run(asCliente, (tx) => tx.supportConversation.update({ where: { id: conv.id }, data: { status: 'WAITING' } }))).rejects.toThrow(/apenas ao atendimento/);
    const closed = await db.run(asCliente, (tx) => tx.supportConversation.update({ where: { id: conv.id }, data: { status: 'CLOSED' } }));
    expect(closed.status).toBe('CLOSED');
  });

  it('equipe do atendimento: só a Matriz do próprio tenant lê e altera as filas', async () => {
    const [, , atendente] = await people();
    const membership = await db.run(matriz(A), (tx) =>
      // Escopo precisa casar com o tipo da organização; a política da equipe depende de quem consulta, não da membership.
      tx.membership.create({ data: { tenantId: A.tenantId, userId: atendente!.id, organizationId: A.farmOrgs[0]!, scope: 'FARM' } }),
    );
    await db.run(matriz(A), (tx) => tx.supportQueueMember.create({ data: { tenantId: A.tenantId, membershipId: membership.id, queue: 'BILLING' } }));
    expect(await db.run(farm(A, 0), (tx) => tx.supportQueueMember.findMany({ where: { membershipId: membership.id } }))).toHaveLength(0);
    expect(await db.run(matriz(B), (tx) => tx.supportQueueMember.findMany({ where: { membershipId: membership.id } }))).toHaveLength(0);
    await expect(
      db.run(farm(A, 0), (tx) => tx.supportQueueMember.create({ data: { tenantId: A.tenantId, membershipId: membership.id, queue: 'SUPPORT' } })),
    ).rejects.toThrow(/row-level security/);
    const removed = await db.run(matriz(A), (tx) => tx.supportQueueMember.deleteMany({ where: { membershipId: membership.id } }));
    expect(removed.count).toBe(1);
  });

  it('Fazenda numera atendimento e ocorrência, mas não outras sequências', async () => {
    const { nextSequence } = await import('./sequences.js');
    const year = 2099;
    const support = await db.run(farm(A, 0), (tx) => nextSequence(tx, A.tenantId, 'support', year));
    const occurrence = await db.run(farm(A, 0), (tx) => nextSequence(tx, A.tenantId, 'occurrence', year));
    expect(support).toBeGreaterThan(0);
    expect(occurrence).toBeGreaterThan(0);
    await expect(db.run(farm(A, 0), (tx) => nextSequence(tx, A.tenantId, 'loading_order', year))).rejects.toThrow(/row-level security/);
    await expect(db.run(buyer(A, 0), (tx) => nextSequence(tx, A.tenantId, 'contract', year))).rejects.toThrow(/row-level security/);
  });

  it('mensagens são imutáveis e conversas não são apagadas', async () => {
    const [cliente] = await people();
    const asCliente = { ...farm(A, 0), userId: cliente!.id };
    const conv = await db.run(asCliente, (tx) => tx.supportConversation.create({ data: conversationData(A, cliente!.id) }));
    const msg = await db.run(asCliente, (tx) => tx.supportMessage.create({ data: { tenantId: A.tenantId, conversationId: conv.id, authorType: 'CUSTOMER', authorUserId: cliente!.id, body: 'original' } }));
    await expect(db.run(matriz(A), (tx) => tx.$executeRaw`update support_messages set body = 'alterada' where id = ${msg.id}::uuid`)).rejects.toThrow(/permission denied|append-only/);
    await expect(db.run(matriz(A), (tx) => tx.$executeRaw`delete from support_conversations where id = ${conv.id}::uuid`)).rejects.toThrow(/permission denied/);
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
