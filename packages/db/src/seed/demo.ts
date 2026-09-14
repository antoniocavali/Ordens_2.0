import { randomUUID } from 'node:crypto';
import type { RoleCode } from '@ordens/contracts';
import type { Database, Tx } from '../client.js';
import { systemContext } from '../context.js';
import type { OrderStatus, Scope } from '../generated/prisma/enums.js';
import { hashPassword } from '../password.js';
import { nextSequence } from '../sequences.js';
import { EMPTY_META, writeAudit } from '../unit-of-work.js';

/** Gerador pseudoaleatório determinístico para dados demo reprodutíveis. */
function rng(seed: number) {
  let s = seed >>> 0;
  const next = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x1_0000_0000;
  };
  return {
    next,
    int: (min: number, max: number) => Math.floor(next() * (max - min + 1)) + min,
    pick: <T>(arr: readonly T[]): T => arr[Math.floor(next() * arr.length)]!,
  };
}

const DAY = 86_400_000;
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY);
const dateOnly = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

/** Chave de acesso de NF-e (44 dígitos) com dígito verificador módulo 11 — dados demo, nunca SEFAZ real. */
function demoNfeKey(issuedAt: Date, issuerDoc: string, nfNumber: number, code: number) {
  const yymm = `${String(issuedAt.getUTCFullYear()).slice(2)}${String(issuedAt.getUTCMonth() + 1).padStart(2, '0')}`;
  const base = `41${yymm}${issuerDoc.padStart(14, '0')}55001${String(nfNumber).padStart(9, '0')}1${String(code).padStart(8, '0')}`;
  let weight = 2;
  let sum = 0;
  for (let i = base.length - 1; i >= 0; i--) {
    sum += Number(base[i]) * weight;
    weight = weight === 9 ? 2 : weight + 1;
  }
  const rest = sum % 11;
  return `${base}${rest < 2 ? 0 : 11 - rest}`;
}

interface DemoUser {
  email: string;
  name: string;
  org: string;
  scope: Scope;
  roles: RoleCode[];
}

export async function seedDemo(db: Database, password: string): Promise<{ created: boolean }> {
  const existing = await db.system((tx) => tx.tenant.findUnique({ where: { slug: 'grao-forte' } }));
  if (existing) return { created: false };

  const passwordHash = await hashPassword(password);

  // Cada tenant é criado atomicamente: falha no meio não deixa dados parciais.
  const tenantId = randomUUID();
  await db.system(
    async (tx) => {
      await tx.tenant.create({ data: { id: tenantId, slug: 'grao-forte', name: 'Grão Forte Agro', viewSlaHours: 24 } });
      await seedTenant(tx, tenantId, passwordHash);
      await tx.user.create({
        data: { email: 'superadmin@ordens.local', name: 'Suporte Plataforma', passwordHash, isPlatformAdmin: true },
      });
    },
    tenantId,
    { timeoutMs: 180_000 },
  );

  // Segundo tenant para demonstrar isolamento.
  const otherId = randomUUID();
  await db.system(async (tx) => {
    await tx.tenant.create({ data: { id: otherId, slug: 'horizonte', name: 'Horizonte Trading' } });
    const matriz = await tx.organization.create({
      data: { tenantId: otherId, kind: 'MATRIZ', name: 'Horizonte Trading — Matriz' },
    });
    const user = await tx.user.create({
      data: { email: 'admin@horizonte.demo', name: 'Marcos Tavares', passwordHash },
    });
    const m = await tx.membership.create({
      data: { tenantId: otherId, userId: user.id, organizationId: matriz.id, scope: 'MATRIZ' },
    });
    await tx.membershipRole.create({ data: { membershipId: m.id, roleCode: 'MATRIZ_ADMIN', tenantId: otherId } });
    await tx.unit.createMany({
      data: [
        { tenantId: otherId, code: 'KG', name: 'Quilograma', factorToKg: '1' },
        { tenantId: otherId, code: 'T', name: 'Tonelada', factorToKg: '1000' },
      ],
    });
  }, otherId);

  return { created: true };
}

async function seedTenant(tx: Tx, tenantId: string, passwordHash: string): Promise<void> {
  const r = rng(20260910);
  const now = new Date();

  // ─── Unidades e commodities ───
  const units = {
    KG: await tx.unit.create({ data: { tenantId, code: 'KG', name: 'Quilograma', factorToKg: '1' } }),
    T: await tx.unit.create({ data: { tenantId, code: 'T', name: 'Tonelada', factorToKg: '1000' } }),
    SC60: await tx.unit.create({ data: { tenantId, code: 'SC60', name: 'Saca 60 kg', factorToKg: '60' } }),
  };

  const commodityDefs = [
    ['MILHO', 'Milho', 'Grãos', '1250.00'],
    ['SOJA', 'Soja', 'Grãos', '2150.00'],
    ['ALGODAO', 'Algodão em pluma', 'Fibras', '9800.00'],
    ['MILHETO', 'Milheto', 'Grãos', '880.00'],
    ['TRIGO', 'Trigo', 'Grãos', '1480.00'],
    ['SORGO', 'Sorgo', 'Grãos', '990.00'],
  ] as const;
  const commodities: Record<string, { id: string; price: string; name: string }> = {};
  for (const [code, name, category, price] of commodityDefs) {
    const c = await tx.commodity.create({
      data: { tenantId, code, name, category, defaultUnitId: units.T.id },
    });
    commodities[code] = { id: c.id, price, name };
  }

  // ─── Parceiros ───
  const partner = async (
    data: { personType: 'PF' | 'PJ'; legalName: string; tradeName?: string; document: string; city: string; state: string; email?: string; phone?: string },
    roles: ('BUYER' | 'SELLER' | 'PRODUCER' | 'COOPERATIVE_MEMBER' | 'COOPERATIVE' | 'CARRIER')[],
  ) => {
    const p = await tx.businessPartner.create({ data: { tenantId, ...data } });
    await tx.partnerRoleAssignment.createMany({ data: roles.map((role) => ({ partnerId: p.id, role, tenantId })) });
    return p;
  };

  const joao = await partner(
    { personType: 'PF', legalName: 'João da Silva', document: '52998224725', city: 'Rio Verde', state: 'GO', phone: '64999990001' },
    ['SELLER', 'PRODUCER'],
  );
  const maria = await partner(
    { personType: 'PF', legalName: 'Maria Souza', document: '11144477735', city: 'Sorriso', state: 'MT', phone: '66999990002' },
    ['SELLER', 'COOPERATIVE_MEMBER'],
  );
  const valeVerde = await partner(
    { personType: 'PJ', legalName: 'Agropecuária Vale Verde Ltda', tradeName: 'Vale Verde', document: '11222333000181', city: 'Luís Eduardo Magalhães', state: 'BA' },
    ['SELLER', 'PRODUCER'],
  );
  const abc = await partner(
    { personType: 'PJ', legalName: 'Cooperativa ABC Alimentos', tradeName: 'Coop. ABC', document: '45997418000153', city: 'Castro', state: 'PR' },
    ['BUYER', 'COOPERATIVE', 'SELLER'],
  );
  const nutri = await partner(
    { personType: 'PJ', legalName: 'Nutri Rações S.A.', tradeName: 'Nutri Rações', document: '33000167000101', city: 'Chapecó', state: 'SC' },
    ['BUYER'],
  );
  const exporta = await partner(
    { personType: 'PJ', legalName: 'Exporta Grãos Ltda', tradeName: 'Exporta Grãos', document: '60701190000104', city: 'Paranaguá', state: 'PR' },
    ['BUYER'],
  );
  const transAgro = await partner(
    { personType: 'PJ', legalName: 'TransAgro Logística Ltda', tradeName: 'TransAgro', document: '07526557000100', city: 'Rondonópolis', state: 'MT' },
    ['CARRIER'],
  );
  const rodoviaSul = await partner(
    { personType: 'PJ', legalName: 'Rodovia Sul Transportes Ltda', tradeName: 'Rodovia Sul', document: '02916265000160', city: 'Cascavel', state: 'PR' },
    ['CARRIER'],
  );

  // ─── Contatos, transportadoras, motoristas e veículos ───
  await tx.partnerContact.createMany({
    data: [
      { tenantId, partnerId: joao.id, name: 'João da Silva', role: 'Proprietário', phone: '64999990001', isPrimary: true },
      { tenantId, partnerId: joao.id, name: 'Marcos (gerente)', role: 'Gerente de fazenda', phone: '64999990011' },
      { tenantId, partnerId: abc.id, name: 'Paulo Ribeiro', role: 'Recebimento', phone: '42999990003', email: 'recebimento@coopabc.demo', isPrimary: true },
    ],
  });
  for (const [carrier, rntrc, name, phone] of [
    [transAgro, '12345678', 'Sandra Lopes', '66999994001'],
    [rodoviaSul, '87654321', 'Ricardo Alves', '45999994002'],
  ] as const) {
    await tx.carrierProfile.create({
      data: { partnerId: carrier.id, tenantId, rntrc, rntrcExpiresAt: dateOnly(addDays(now, 400)), opsContactName: name, opsContactPhone: phone },
    });
  }
  const drivers = [
    ['Antônio Pereira', '39053344705', transAgro.id, 'E', 300],
    ['Carlos Mendonça', '71428793860', transAgro.id, 'E', 20],
    ['Edson Batista', '15350946056', rodoviaSul.id, 'E', -10],
    ['Gilmar Souza', '86288366757', rodoviaSul.id, 'D', 600],
  ] as const;
  const driverIds: Record<string, string> = {};
  for (const [name, cpf, carrierPartnerId, cnhCategory, days] of drivers) {
    const d = await tx.driver.create({
      data: { tenantId, name, cpf, carrierPartnerId, cnhCategory, cnhExpiresAt: dateOnly(addDays(now, days)), phone: `669${cpf.slice(0, 8)}` },
    });
    driverIds[name] = d.id;
  }
  const vehicles = [
    ['RVG1A23', 'TRUCK_TRACTOR', transAgro.id, null, 'Scania', 'R 450', 2022],
    ['RVG2B34', 'BITRAIN', transAgro.id, '37000', 'Randon', 'Bitrem graneleiro', 2021],
    ['PRS3C45', 'TRUCK_TRACTOR', rodoviaSul.id, null, 'Volvo', 'FH 540', 2023],
    ['PRS4D56', 'ROAD_TRAIN', rodoviaSul.id, '57000', 'Librelato', 'Rodotrem graneleiro', 2020],
  ] as const;
  const vehicleIds: Record<string, string> = {};
  for (const [plate, type, carrierPartnerId, capacityKg, brand, model, year] of vehicles) {
    vehicleIds[plate] = (await tx.vehicle.create({ data: { tenantId, plate, type, carrierPartnerId, capacityKg, brand, model, year } })).id;
  }
  // Conjuntos válidos (motorista com CNH em dia + veículos da mesma transportadora).
  const fleets = [
    { carrierPartnerId: transAgro.id, driverId: driverIds['Antônio Pereira']!, tractorVehicleId: vehicleIds.RVG1A23!, trailerVehicleId: vehicleIds.RVG2B34!, plates: ['RVG1A23', 'RVG2B34'], truckT: 37 },
    { carrierPartnerId: rodoviaSul.id, driverId: driverIds['Gilmar Souza']!, tractorVehicleId: vehicleIds.PRS3C45!, trailerVehicleId: vehicleIds.PRS4D56!, plates: ['PRS3C45', 'PRS4D56'], truckT: 50 },
  ];

  // ─── Organizações ───
  const orgMatriz = await tx.organization.create({ data: { tenantId, kind: 'MATRIZ', name: 'Grão Forte Agro — Matriz' } });
  const orgJoao = await tx.organization.create({ data: { tenantId, kind: 'FARM', name: 'João da Silva — Produtor', partnerId: joao.id } });
  const orgMaria = await tx.organization.create({ data: { tenantId, kind: 'FARM', name: 'Maria Souza — Cooperada', partnerId: maria.id } });
  const orgVale = await tx.organization.create({ data: { tenantId, kind: 'FARM', name: 'Vale Verde', partnerId: valeVerde.id } });
  const orgAbc = await tx.organization.create({ data: { tenantId, kind: 'BUYER', name: 'Cooperativa ABC', partnerId: abc.id } });
  const orgNutri = await tx.organization.create({ data: { tenantId, kind: 'BUYER', name: 'Nutri Rações', partnerId: nutri.id } });

  // ─── Fazendas ───
  const farm = (ownerPartnerId: string, organizationId: string, name: string, code: string, city: string, state: string, lat: string, lng: string) =>
    tx.farm.create({
      data: {
        tenantId,
        ownerPartnerId,
        organizationId,
        name,
        code,
        city,
        state,
        latitude: lat,
        longitude: lng,
        loadingPoint: 'Armazém principal',
        operatingHours: { weekdays: '06:00-18:00', saturday: '06:00-12:00' },
        dailyCapacity: String(r.int(8, 30) * 100),
      },
    });

  const farmsBySeller: Record<string, { id: string }[]> = {
    [joao.id]: [
      await farm(joao.id, orgJoao.id, 'Fazenda Primavera', 'FAZ-001', 'Rio Verde', 'GO', '-17.7923', '-50.9192'),
      await farm(joao.id, orgJoao.id, 'Fazenda Santa Maria', 'FAZ-002', 'Jataí', 'GO', '-17.8814', '-51.7144'),
      await farm(joao.id, orgJoao.id, 'Fazenda São José', 'FAZ-003', 'Montividiu', 'GO', '-17.4439', '-51.1731'),
    ],
    [maria.id]: [
      await farm(maria.id, orgMaria.id, 'Fazenda Boa Esperança', 'FAZ-004', 'Sorriso', 'MT', '-12.5425', '-55.7211'),
      await farm(maria.id, orgMaria.id, 'Fazenda Três Irmãos', 'FAZ-005', 'Lucas do Rio Verde', 'MT', '-13.0588', '-55.9042'),
    ],
    [valeVerde.id]: [
      await farm(valeVerde.id, orgVale.id, 'Fazenda Chapadão', 'FAZ-006', 'Luís Eduardo Magalhães', 'BA', '-12.0964', '-45.7866'),
    ],
  };

  // ─── Usuários ───
  const users: DemoUser[] = [
    { email: 'admin@graoforte.demo', name: 'Carla Mendes', org: orgMatriz.id, scope: 'MATRIZ', roles: ['MATRIZ_ADMIN'] },
    { email: 'gestor@graoforte.demo', name: 'Rafael Lima', org: orgMatriz.id, scope: 'MATRIZ', roles: ['MATRIZ_MANAGER'] },
    { email: 'operador@graoforte.demo', name: 'Bruna Costa', org: orgMatriz.id, scope: 'MATRIZ', roles: ['MATRIZ_OPERATOR'] },
    { email: 'leitura@graoforte.demo', name: 'Diego Alves', org: orgMatriz.id, scope: 'MATRIZ', roles: ['MATRIZ_VIEWER'] },
    { email: 'faturamento@graoforte.demo', name: 'Luana Prado', org: orgMatriz.id, scope: 'MATRIZ', roles: ['MATRIZ_BILLING_AGENT'] },
    { email: 'suporte@graoforte.demo', name: 'Marcos Teixeira', org: orgMatriz.id, scope: 'MATRIZ', roles: ['MATRIZ_SUPPORT_AGENT'] },
    { email: 'fazenda.joao@graoforte.demo', name: 'João da Silva', org: orgJoao.id, scope: 'FARM', roles: ['FARM_ADMIN'] },
    { email: 'fazenda.maria@graoforte.demo', name: 'Ana Souza', org: orgMaria.id, scope: 'FARM', roles: ['FARM_OPERATOR'] },
    { email: 'comprador.abc@graoforte.demo', name: 'Paulo Ribeiro', org: orgAbc.id, scope: 'BUYER', roles: ['BUYER_USER'] },
    { email: 'comprador.nutri@graoforte.demo', name: 'Fernanda Rocha', org: orgNutri.id, scope: 'BUYER', roles: ['BUYER_USER'] },
  ];
  const userIds: Record<string, { userId: string; membershipId: string }> = {};
  for (const u of users) {
    const user = await tx.user.create({ data: { email: u.email, name: u.name, passwordHash } });
    const m = await tx.membership.create({
      data: { tenantId, userId: user.id, organizationId: u.org, scope: u.scope },
    });
    await tx.membershipRole.createMany({ data: u.roles.map((roleCode) => ({ membershipId: m.id, roleCode, tenantId })) });
    userIds[u.email] = { userId: user.id, membershipId: m.id };
  }
  const admin = userIds['admin@graoforte.demo']!;
  const gestor = userIds['gestor@graoforte.demo']!;

  // ─── Contratos ───
  // Numeração igual à automática da API (CT-AAAA-NNNN), avançando a sequência do tenant.
  const contract = async (_label: string, seller: string, buyer: string, commodity: string, quantity: string, unitPrice: string, crop: string) => {
    const seq = await nextSequence(tx, tenantId, 'contract', now.getUTCFullYear());
    return tx.contract.create({
      data: {
        tenantId,
        number: `CT-${now.getUTCFullYear()}-${String(seq).padStart(4, '0')}`,
        sellerPartnerId: seller,
        buyerPartnerId: buyer,
        commodityId: commodities[commodity]!.id,
        cropYear: crop,
        quantity,
        unitId: units.T.id,
        unitPrice,
        currency: 'BRL',
        totalValue: (BigInt(quantity) * BigInt(unitPrice.replace('.', ''))).toString().replace(/(\d{2})$/, '.$1'),
        startsOn: dateOnly(addDays(now, -60)),
        endsOn: dateOnly(addDays(now, 120)),
        freightMode: 'FOB',
        status: 'ACTIVE',
      },
    });
  };

  const contracts = [
    { c: await contract('CT-2026-001', joao.id, abc.id, 'MILHO', '12000', '1250.00', '25/26'), seller: joao.id, buyer: abc.id, commodity: 'MILHO' },
    { c: await contract('CT-2026-002', maria.id, nutri.id, 'SOJA', '8000', '2150.00', '25/26'), seller: maria.id, buyer: nutri.id, commodity: 'SOJA' },
    { c: await contract('CT-2026-003', valeVerde.id, exporta.id, 'ALGODAO', '1500', '9800.00', '25/26'), seller: valeVerde.id, buyer: exporta.id, commodity: 'ALGODAO' },
    { c: await contract('CT-2026-004', joao.id, nutri.id, 'SORGO', '4000', '990.00', '25/26'), seller: joao.id, buyer: nutri.id, commodity: 'SORGO' },
    { c: await contract('CT-2026-005', maria.id, abc.id, 'MILHO', '6000', '1240.00', '25/26'), seller: maria.id, buyer: abc.id, commodity: 'MILHO' },
  ];

  // ─── Ordens de carregamento ───
  const statusPlan: OrderStatus[] = [
    ...Array<OrderStatus>(5).fill('DRAFT'),
    ...Array<OrderStatus>(20).fill('PUBLISHED'),
    ...Array<OrderStatus>(10).fill('IN_PROGRESS'),
    'SUSPENDED',
    'SUSPENDED',
    'COMPLETED',
    'COMPLETED',
    'CANCELLED',
  ];
  const quantities = [300, 450, 600, 800, 1000, 1200, 1500, 2000];
  const carriers = [transAgro.id, rodoviaSul.id, null];
  const priorities = ['NORMAL', 'NORMAL', 'NORMAL', 'HIGH', 'LOW', 'URGENT'] as const;
  const orgUsers: Record<string, { userId: string; membershipId: string } | undefined> = {
    [orgJoao.id]: userIds['fazenda.joao@graoforte.demo'],
    [orgMaria.id]: userIds['fazenda.maria@graoforte.demo'],
    [orgAbc.id]: userIds['comprador.abc@graoforte.demo'],
    [orgNutri.id]: userIds['comprador.nutri@graoforte.demo'],
  };

  // Saldo por contrato: ordens não-rascunho só usam contrato enquanto houver saldo (mesma regra da publicação).
  const committed = new Map<string, number>(contracts.map((k) => [k.c.id, 0]));

  for (let i = 0; i < statusPlan.length; i++) {
    const status = statusPlan[i]!;
    const k = r.pick(contracts);
    const qtyPreview = quantities[i % quantities.length]!;
    const fits = committed.get(k.c.id)! + qtyPreview <= Number(k.c.quantity);
    const useContract = r.next() < 0.8 && (status === 'DRAFT' || fits);
    if (useContract && status !== 'DRAFT' && status !== 'CANCELLED') committed.set(k.c.id, committed.get(k.c.id)! + qtyPreview);
    const seller = useContract ? k.seller : r.pick([joao.id, maria.id, valeVerde.id]);
    const buyer = useContract ? k.buyer : r.pick([abc.id, nutri.id, exporta.id]);
    const commodityCode = useContract ? k.commodity : r.pick(['MILHO', 'SOJA', 'MILHETO', 'TRIGO']);
    const commodity = commodities[commodityCode]!;
    const farmRow = r.pick(farmsBySeller[seller]!);
    const qty = qtyPreview;
    const startOffset = status === 'COMPLETED' ? -r.int(40, 60) : r.int(-25, 30);
    const starts = dateOnly(addDays(now, startOffset));
    const ends = addDays(starts, r.int(10, 35));
    const createdAt = addDays(starts, -r.int(3, 15));
    const seq = await nextSequence(tx, tenantId, 'loading_order', 2026);
    const number = `2026/${String(seq).padStart(5, '0')}`;
    const isPublished = status !== 'DRAFT';
    const version = isPublished ? r.int(1, 3) : 0;
    const creator = r.next() < 0.5 ? admin : gestor;

    const order = await tx.loadingOrder.create({
      data: {
        tenantId,
        number,
        externalNumber: r.next() < 0.4 ? String(r.int(80000, 99999)) : null,
        orderDate: dateOnly(createdAt),
        status,
        priority: r.pick(priorities),
        operationType: 'PURCHASE',
        version,
        contractId: useContract ? k.c.id : null,
        sellerPartnerId: status === 'DRAFT' && i === 0 ? seller : seller,
        farmId: status === 'DRAFT' && i === 1 ? null : farmRow.id,
        buyerPartnerId: status === 'DRAFT' && i === 2 ? null : buyer,
        commodityId: commodity.id,
        cropYear: '25/26',
        quantity: status === 'DRAFT' && i === 3 ? null : String(qty),
        unitId: units.T.id,
        unitPrice: commodity.price,
        currency: 'BRL',
        freightMode: r.pick(['FOB', 'CIF', 'TO_DEFINE'] as const),
        freightEstimate: String(qty * r.int(90, 180)) + '.00',
        preferredCarrierId: r.pick(carriers),
        loadingStartsOn: starts,
        loadingEndsOn: dateOnly(ends),
        tolerancePct: r.pick(['0', '0.5', '1', '2']),
        destinationName: buyer === abc.id ? 'Unidade Castro — Recebimento' : buyer === nutri.id ? 'Fábrica Chapecó' : 'Terminal Paranaguá',
        destinationCity: buyer === abc.id ? 'Castro' : buyer === nutri.id ? 'Chapecó' : 'Paranaguá',
        destinationState: buyer === nutri.id ? 'SC' : 'PR',
        loadingInstructions: 'Umidade máxima 14%. Impurezas até 1%. Apresentar romaneio na portaria.',
        farmNotes: r.next() < 0.5 ? 'Priorizar carregamento no período da manhã.' : null,
        internalNotes: r.next() < 0.3 ? 'Acompanhar margem com a mesa comercial.' : null,
        publishedAt: isPublished ? addDays(createdAt, 1) : null,
        lastMaterialChangeAt: isPublished ? addDays(createdAt, version) : null,
        createdAt,
        createdBy: creator.userId,
        updatedBy: creator.userId,
      },
    });

    const meta = { ...EMPTY_META, actorUserId: creator.userId, actorMembershipId: creator.membershipId, actorRole: 'MATRIZ_ADMIN', correlationId: 'seed-demo' };
    const ctx = systemContext(tenantId);
    await writeAudit(tx, ctx, meta, { entityType: 'loading_order', entityId: order.id, action: 'order.created', after: { number } });

    if (!isPublished) continue;

    await writeAudit(tx, ctx, meta, { entityType: 'loading_order', entityId: order.id, action: 'order.published', after: { version: 1 } });

    for (let v = 1; v <= version; v++) {
      await tx.loadingOrderVersion.create({
        data: {
          tenantId,
          orderId: order.id,
          version: v,
          materialSnapshot: { quantity: String(qty), farmId: farmRow.id, loadingStartsOn: starts.toISOString().slice(0, 10) },
          changedFields: v === 1 ? [] : [{ field: 'loadingEndsOn', from: null, to: dateOnly(ends).toISOString().slice(0, 10) }],
          createdBy: creator.userId,
          createdAt: addDays(createdAt, v),
        },
      });
    }

    // Liberações parciais
    const releaseCount = status === 'PUBLISHED' ? r.int(0, 2) : r.int(1, 3);
    let released = 0;
    for (let s = 1; s <= releaseCount; s++) {
      const part = Math.min(qty - released, Math.round((qty * r.int(15, 40)) / 100 / 10) * 10);
      if (part <= 0) break;
      released += part;
      await tx.loadingOrderRelease.create({
        data: {
          tenantId,
          orderId: order.id,
          sequence: s,
          quantity: String(part),
          orderVersion: Math.min(s, version),
          status: status === 'COMPLETED' ? 'CONSUMED' : 'ACTIVE',
          createdBy: gestor.userId,
          createdAt: addDays(createdAt, s + 1),
          notes: s === 1 ? 'Liberação inicial' : null,
        },
      });
      await writeAudit(tx, ctx, { ...meta, actorUserId: gestor.userId, actorMembershipId: gestor.membershipId, actorRole: 'MATRIZ_MANAGER' }, {
        entityType: 'loading_order',
        entityId: order.id,
        action: 'order.release_created',
        after: { sequence: s, quantity: String(part) },
      });
    }
    if (status === 'COMPLETED') released = qty;

    await tx.loadingOrder.update({
      where: { id: order.id },
      data: { releasedQty: String(released), cancelledQty: status === 'CANCELLED' ? String(qty) : '0' },
    });

    // Totais operacionais nascem de cargas e agendamentos reais (recalc_order_quantities).
    const fleet = r.pick(fleets);
    const split = (total: number) => {
      const parts: number[] = [];
      for (let left = total; left > 0; left -= fleet.truckT) parts.push(Math.min(fleet.truckT, left));
      return parts;
    };
    const fleetData = {
      carrierPartnerId: fleet.carrierPartnerId,
      driverId: fleet.driverId,
      tractorVehicleId: fleet.tractorVehicleId,
      trailerVehicleId: fleet.trailerVehicleId,
      plates: fleet.plates,
    };
    const loadedTarget = status === 'IN_PROGRESS' ? Math.round((released * r.int(20, 70)) / 100) : status === 'COMPLETED' ? qty : 0;
    const trucks = split(loadedTarget);
    const receivedTrucks = status === 'COMPLETED' ? trucks.length : Math.floor((trucks.length * r.int(30, 80)) / 100);
    // Histórico real: a carga só vira "Carregada" depois da NF-e da Fazenda (um evento a cada 3 h).
    const path = ['SCHEDULED', 'LOADING', 'AWAITING_FARM_INVOICE', 'FARM_INVOICED', 'LOADED', 'IN_TRANSIT', 'ARRIVED', 'RECEIVED', 'COMPLETED'] as const;
    const stepAt = (base: Date, step: (typeof path)[number]) => new Date(base.getTime() + path.indexOf(step) * 3 * 3_600_000);
    const sellerPartner = trucks.length
      ? await tx.businessPartner.findUniqueOrThrow({ where: { id: seller }, select: { legalName: true, document: true } })
      : null;
    const buyerPartner = trucks.length ? await tx.businessPartner.findUnique({ where: { id: buyer }, select: { legalName: true, document: true } }) : null;
    let sequence = 0;
    for (const [t, tons] of trucks.entries()) {
      sequence++;
      const finalStatus = t < receivedTrucks ? 'COMPLETED' : r.pick(['LOADED', 'IN_TRANSIT', 'ARRIVED'] as const);
      const loadingDate = addDays(createdAt, 2 + t);
      const netKg = tons * 1000;
      const tareKg = 16_000 + r.int(0, 3000);
      const reachedReceipt = (['RECEIVED', 'COMPLETED'] as string[]).includes(finalStatus);
      const load = await tx.load.create({
        data: {
          tenantId,
          orderId: order.id,
          number: `${number}-C${String(sequence).padStart(2, '0')}`,
          sequence,
          loadingDate: dateOnly(loadingDate),
          expectedQty: String(tons),
          ...fleetData,
          tareKg: String(tareKg),
          grossKg: String(tareKg + netKg),
          netKg: String(netKg),
          receivedQty: finalStatus === 'COMPLETED' ? (tons - r.int(0, 60) / 1000).toFixed(3) : null,
          status: finalStatus,
          // Coerentes com o histórico gerado abaixo.
          loadedAt: stepAt(loadingDate, 'LOADED'),
          receivedAt: reachedReceipt ? stepAt(loadingDate, 'RECEIVED') : null,
          createdBy: creator.userId,
          createdAt: loadingDate,
        },
      });
      const steps = path.slice(0, path.indexOf(finalStatus) + 1);
      await tx.loadStatusHistory.createMany({
        data: steps.map((to, i) => ({
          tenantId,
          loadId: load.id,
          fromStatus: i === 0 ? null : steps[i - 1],
          toStatus: to,
          actorUserId: creator.userId,
          occurredAt: stepAt(loadingDate, to),
        })),
      });

      // NF-e da Fazenda que permitiu o faturamento (sem XML anexado: dado demo).
      const issuedAt = stepAt(loadingDate, 'FARM_INVOICED');
      const issuerDoc = (sellerPartner!.document ?? '').replace(/\D/g, '');
      const nfNumber = Number(number.slice(5)) * 100 + sequence;
      await tx.invoice.create({
        data: {
          tenantId,
          loadId: load.id,
          orderId: order.id,
          origin: 'FARM',
          status: 'VALID',
          accessKey: demoNfeKey(issuedAt, issuerDoc, nfNumber, r.int(10_000_000, 99_999_999)),
          number: String(nfNumber),
          series: '1',
          issuedAt,
          issuerDocument: issuerDoc || null,
          issuerName: sellerPartner!.legalName,
          recipientDocument: buyerPartner?.document?.replace(/\D/g, '') || null,
          recipientName: buyerPartner?.legalName ?? null,
          totalValue: (tons * Number(commodity.price)).toFixed(2),
          netWeightKg: String(netKg),
          grossWeightKg: String(tareKg + netKg),
          quantity: String(netKg),
          quantityUnit: 'KG',
          productDescription: `${commodityCode} EM GRAOS`,
          plate: fleet.plates[0] ?? null,
          protocolStatus: '100',
          createdBy: creator.userId,
          createdAt: issuedAt,
        },
      });
    }
    if (status === 'IN_PROGRESS' || status === 'PUBLISHED') {
      const scheduledTarget = Math.max(0, Math.round(((released - loadedTarget) * r.int(0, 60)) / 100));
      for (const [i, tons] of split(scheduledTarget).entries()) {
        await tx.appointment.create({
          data: {
            tenantId,
            orderId: order.id,
            scheduledOn: dateOnly(addDays(now, i + r.int(0, 3))),
            windowStart: '07:00',
            windowEnd: '11:00',
            expectedQty: String(tons),
            ...fleetData,
            status: 'CONFIRMED',
            createdBy: creator.userId,
          },
        });
      }
    }
    await tx.$executeRaw`select recalc_order_quantities(${order.id}::uuid)`;
    await tx.loadingOrder.update({ where: { id: order.id }, data: { updatedAt: addDays(createdAt, version + releaseCount) } });

    // Visualizações (faróis)
    const fresh = await tx.loadingOrder.findUniqueOrThrow({ where: { id: order.id }, select: { sellerOrgId: true, buyerOrgId: true } });
    for (const [side, orgId] of [['FARM', fresh.sellerOrgId], ['BUYER', fresh.buyerOrgId]] as const) {
      if (!orgId) continue;
      const viewer = orgUsers[orgId];
      if (!viewer) continue;
      const roll = r.next();
      if (roll < 0.25) continue; // nunca visualizada
      const viewedVersion = roll < 0.55 && version > 1 ? version - 1 : version;
      const viewedAt = addDays(createdAt, viewedVersion + 1);
      await tx.loadingOrderView.create({
        data: {
          tenantId,
          orderId: order.id,
          organizationId: orgId,
          side,
          userId: viewer.userId,
          membershipId: viewer.membershipId,
          version: viewedVersion,
          firstViewedAt: viewedAt,
          lastViewedAt: viewedAt,
          viewCount: r.int(1, 6),
          correlationId: 'seed-demo',
        },
      });
    }
  }
}
