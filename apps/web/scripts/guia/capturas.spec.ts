import { createRequire } from 'node:module';
import path from 'node:path';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { apiOk, MATRIZ_RECIPIENT_DOC, nfeKey, nfeXml, password, PDF, submitLogin } from '../../e2e/helpers';

/**
 * Gera as capturas de /apresentacao e /guia a partir do ambiente local de demonstração: cria uma ordem,
 * percorre o fluxo inteiro com cada parte (Matriz, Fazenda, Comprador) e fotografa as telas no caminho.
 * As imagens saem em public/guia/<nome>.webp — os nomes são referenciados em src/features/guide.
 */
const require = createRequire(import.meta.url);
// O sharp vem com o Next; resolve a partir dele (o pnpm não o expõe direto ao app).
const sharp = require(require.resolve('sharp', { paths: [path.dirname(require.resolve('next/package.json'))] })) as typeof import('sharp');
const OUT = path.resolve(import.meta.dirname, '../../public/guia');

const addDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

const THEME = 'light';

async function shot(page: Page, name: string) {
  // Indicador do Next em desenvolvimento não entra na foto.
  await page.addStyleTag({ content: 'nextjs-portal{display:none!important}' }).catch(() => undefined);
  // Avisos temporários (toasts) e o botão do atendimento não entram na foto.
  await page.waitForTimeout(900);
  await page.evaluate(() => document.querySelectorAll('[data-sonner-toaster]').forEach((t) => ((t as HTMLElement).style.visibility = 'hidden')));
  const png = await page.screenshot({ type: 'png' });
  await sharp(png).webp({ quality: 82 }).toFile(path.join(OUT, `${name}.webp`));
  await page.evaluate(() => document.querySelectorAll('[data-sonner-toaster]').forEach((t) => ((t as HTMLElement).style.visibility = '')));
  console.log('captura', name);
}

async function session(browser: Browser, email: string) {
  const context = await browser.newContext();
  await context.addInitScript(() => localStorage.setItem('theme', 'light'));
  const page = await context.newPage();
  await submitLogin(page, email, password, '/');
  // O tema fica nas preferências da conta: as capturas são sempre no claro.
  await apiOk(page, 'PATCH', '/me/preferences', { theme: THEME });
  await page.reload();
  return page;
}

/** Abre a rota e espera a tela assentar antes da foto. */
async function visit(page: Page, url: string, name: string) {
  await page.goto(url);
  await page.waitForLoadState('networkidle').catch(() => undefined);
  await shot(page, name);
}

test('capturas do guia e da apresentação', async ({ browser }) => {
  test.skip(!password, 'Defina E2E_PASSWORD com a senha demo');

  // ─── Tela de entrada ───
  const anon = await (await browser.newContext()).newPage();
  await anon.addInitScript(() => localStorage.setItem('theme', 'light'));
  await visit(anon, '/login', 'login');
  await anon.context().close();

  const matriz = await session(browser, 'admin@graoforte.demo');
  const fazenda = await session(browser, 'fazenda.joao@graoforte.demo');
  const comprador = await session(browser, 'comprador.abc@graoforte.demo');

  // ─── Dados: uma ordem da Matriz e uma solicitação do Comprador ───
  const sellers = (await apiOk(matriz, 'GET', '/lookups/partners?role=SELLER&limit=20')).items as any[];
  const seller = sellers.find((s) => /jo[aã]o/i.test(s.label)) ?? sellers[0];
  const farm = ((await apiOk(matriz, 'GET', `/lookups/farms?sellerId=${seller.id}&limit=5`)).items as any[])[0];
  const buyer = ((await apiOk(matriz, 'GET', '/lookups/partners?role=BUYER&limit=20')).items as any[]).find((b) => /abc/i.test(b.label));
  const commodities = (await apiOk(matriz, 'GET', '/lookups/commodities')).items as any[];
  const commodity = commodities.find((c) => /soja/i.test(c.label)) ?? commodities[0];
  const unit = ((await apiOk(matriz, 'GET', '/lookups/units')) as any[]).find((u) => u.label === 't');
  const transport = {
    carrierName: 'Trans Agro Logística',
    driverName: 'Antônio Pereira',
    driverCpf: '39053344705',
    vehicles: [{ plate: 'RVG1A23', type: 'TRUCK_TRACTOR' }],
  };
  const orderBody = {
    sellerPartnerId: seller.id,
    farmId: farm.id,
    buyerPartnerId: buyer.id,
    commodityId: commodity.id,
    unitId: unit.id,
    quantity: '120',
    loadingStartsOn: addDays(1),
    loadingEndsOn: addDays(30),
    destinationName: 'Unidade Castro',
    destinationCity: 'Castro',
    destinationState: 'PR',
    ...transport,
  };
  const draft = await apiOk(matriz, 'POST', '/orders', orderBody);
  const spare = await apiOk(matriz, 'POST', '/orders', { ...orderBody, quantity: '45' });
  const sellerDoc = String((await apiOk(matriz, 'GET', `/partners/${seller.id}`)).document ?? '').replace(/\D/g, '');

  // ─── MATRIZ: visão, ordens, nova ordem, rascunho ───
  await visit(matriz, '/', 'matriz-visao-geral');
  await visit(matriz, '/ordens', 'matriz-ordens');
  await matriz.getByRole('button', { name: 'Nova Ordem' }).first().click();
  await expect(matriz.getByRole('dialog').first()).toBeVisible();
  await shot(matriz, 'matriz-nova-ordem');
  await matriz.keyboard.press('Escape');
  await visit(matriz, `/ordens/${draft.id}`, 'matriz-ordem-rascunho');

  // Excluir (no rascunho que sobra).
  await matriz.goto(`/ordens/${spare.id}`);
  await matriz.getByRole('button', { name: 'Excluir', exact: true }).click();
  const del = matriz.getByRole('dialog', { name: 'Excluir rascunho' });
  await del.getByLabel('Motivo').fill('Lançada em duplicidade');
  await del.getByLabel(`Digite ${spare.number} para confirmar`).fill(spare.number);
  await shot(matriz, 'matriz-excluir-ordem');
  await del.getByRole('button', { name: 'Excluir definitivamente' }).click();
  await expect(matriz).toHaveURL(/\/ordens$/);

  const order = await apiOk(matriz, 'POST', `/orders/${draft.id}/publish`, { expectedUpdatedAt: draft.updatedAt });
  await visit(matriz, `/ordens/${order.id}`, 'matriz-ordem-publicada');

  // ─── COMPRADOR: visão, solicitação ───
  await visit(comprador, '/', 'comprador-visao-geral');
  await comprador.goto('/ordens?nova=1');
  const request = comprador.getByRole('dialog', { name: /Nova solicitação de ordem/ });
  await expect(request.getByRole('button', { name: 'Enviar ao Faturamento' })).toBeVisible();
  await shot(comprador, 'comprador-nova-solicitacao');
  await comprador.keyboard.press('Escape');
  const milho = commodities.find((c) => /milho/i.test(c.label)) ?? commodities[0];
  const buyerDraft = await apiOk(comprador, 'POST', '/orders/buyer', {
    commodityId: milho.id,
    quantity: '60',
    unitId: unit.id,
    loadingStartsOn: addDays(2),
    loadingEndsOn: addDays(25),
    destinationName: 'Unidade Castro',
    destinationCity: 'Castro',
    destinationState: 'PR',
    freightMode: 'FOB',
    ...transport,
    buyerNotes: 'Recebimento até 17h',
  });
  await visit(comprador, `/ordens/${buyerDraft.id}`, 'comprador-solicitacao-rascunho');
  await comprador.getByRole('button', { name: 'Enviar ao Faturamento' }).click();
  await expect(comprador.getByRole('status').filter({ hasText: 'Aguardando faturamento' })).toBeVisible();
  await shot(comprador, 'comprador-solicitacao-enviada');

  // ─── FATURAMENTO: definir fazenda (com o contrato digitado) ───
  await matriz.goto(`/ordens/${buyerDraft.id}`);
  await matriz.getByRole('button', { name: 'Definir fazenda' }).click();
  await expect(matriz.getByRole('dialog').first()).toBeVisible();
  await shot(matriz, 'matriz-definir-fazenda');
  await matriz.keyboard.press('Escape');

  // ─── FAZENDA: visão, ordem, chegada, carregamento, documentos ───
  await visit(fazenda, '/', 'fazenda-visao-geral');
  await visit(fazenda, '/ordens', 'fazenda-ordens');
  await visit(fazenda, `/ordens/${order.id}`, 'fazenda-ordem');
  const created = fazenda.waitForResponse((r) => r.url().includes('/api/loads/arrival') && r.request().method() === 'POST');
  await fazenda.getByRole('button', { name: 'Informar chegada do caminhão' }).click();
  const load = await (await created).json();
  const drawer = fazenda.getByRole('dialog').first();
  await expect(drawer.getByText(load.number).first()).toBeVisible({ timeout: 15_000 });
  await shot(fazenda, 'fazenda-carga-chegada');
  const getLoad = () => apiOk(fazenda, 'GET', `/loads/${load.id}`);
  const advance = async (page: Page, label: string) => {
    const response = page.waitForResponse((r) => r.url().includes(`/loads/${load.id}/transition`) && r.request().method() === 'POST');
    await page.getByRole('dialog').first().getByRole('button', { name: label, exact: true }).click();
    expect((await response).ok()).toBe(true);
  };
  await advance(fazenda, 'Iniciar carregamento');
  await drawer.getByLabel('Peso bruto (kg)').fill('48500');
  await drawer.getByLabel('Tara (kg)').fill('16500');
  await shot(fazenda, 'fazenda-carga-pesagem');
  await advance(fazenda, 'Confirmar carregamento');
  const input = drawer.locator('input[type="file"]').first();
  await input.setInputFiles({ name: 'danfe.pdf', mimeType: 'application/pdf', buffer: PDF });
  const key = nfeKey(sellerDoc);
  await input.setInputFiles({ name: `NFe${key}.xml`, mimeType: 'application/xml', buffer: Buffer.from(nfeXml({ key, issuerDoc: sellerDoc, plate: 'RVG1A23', netKg: 32_000 })) });
  await expect.poll(async () => (await getLoad()).fiscalChecklist?.ready, { timeout: 60_000 }).toBe(true);
  await fazenda.reload();
  await expect(drawer.getByRole('button', { name: 'Concluir validação fiscal', exact: true })).toBeVisible();
  await drawer.getByText('Documentação fiscal da Fazenda').scrollIntoViewIfNeeded();
  await shot(fazenda, 'fazenda-carga-documentos');
  await advance(fazenda, 'Concluir validação fiscal');
  await expect(fazenda.getByRole('status').filter({ hasText: 'Etapa da Fazenda concluída' })).toBeVisible();
  await shot(fazenda, 'fazenda-etapa-concluida');
  await fazenda.getByRole('tab', { name: 'Cargas', exact: true }).click();
  await shot(fazenda, 'fazenda-cargas');
  await visit(fazenda, '/documentos', 'fazenda-documentos');
  await visit(fazenda, '/cadastros/fazendas', 'fazenda-cadastro');
  await visit(fazenda, '/gestao/usuarios', 'fazenda-usuarios');

  // ─── MATRIZ: faturar, liberar para trânsito ───
  await visit(matriz, `/ordens/${order.id}`, 'matriz-proxima-etapa');
  await matriz.goto(`/ordens/${order.id}?carga=${load.id}`);
  const mDrawer = matriz.getByRole('dialog').first();
  await expect(mDrawer.getByText('Nota da Matriz para o Comprador')).toBeVisible();
  await shot(matriz, 'matriz-carga-faturamento');
  const mInput = mDrawer.locator('input[type="file"]').last();
  await mInput.setInputFiles({ name: 'nota-matriz.pdf', mimeType: 'application/pdf', buffer: PDF });
  const getM = () => apiOk(matriz, 'GET', `/loads/${load.id}`);
  await expect.poll(async () => (await getM()).matrizChecklist?.pdf, { timeout: 45_000 }).toBe('OK');
  const mKey = nfeKey(MATRIZ_RECIPIENT_DOC);
  await mInput.setInputFiles({ name: `NFe${mKey}.xml`, mimeType: 'application/xml', buffer: Buffer.from(nfeXml({ key: mKey, issuerDoc: MATRIZ_RECIPIENT_DOC, plate: 'RVG1A23', netKg: 32_000 })) });
  await expect.poll(async () => (await getM()).matrizChecklist?.ready, { timeout: 45_000 }).toBe(true);
  await matriz.reload();
  await mDrawer.getByText('Nota da Matriz para o Comprador').scrollIntoViewIfNeeded();
  await shot(matriz, 'matriz-carga-nota-matriz');
  await advance(matriz, 'Registrar faturamento da Matriz');
  await expect(mDrawer.getByRole('button', { name: /Liberar para tr/ })).toBeVisible();
  await mDrawer.evaluate((el) => el.querySelectorAll('*').forEach((n) => (n.scrollTop = 0)));
  await shot(matriz, 'matriz-carga-liberar');
  await advance(matriz, 'Liberar para trânsito');
  await matriz.waitForTimeout(800);
  await shot(matriz, 'matriz-carga-concluida');
  await matriz.keyboard.press('Escape');
  await matriz.goto(`/ordens/${order.id}`);
  await matriz.getByRole('tab', { name: 'Cargas', exact: true }).click();
  await shot(matriz, 'matriz-ordem-cargas');

  // ─── COMPRADOR: acompanha a ordem e os documentos ───
  await visit(comprador, '/ordens', 'comprador-ordens');
  await visit(comprador, `/ordens/${order.id}`, 'comprador-ordem');
  await visit(comprador, '/documentos', 'comprador-documentos');
  await visit(comprador, '/documentos/nfe', 'comprador-nfe');

  // ─── MATRIZ: demais telas ───
  for (const [url, name] of [
    ['/', 'matriz-visao-geral'],
    ['/ordens', 'matriz-ordens'],
    ['/ocorrencias', 'matriz-ocorrencias'],
    ['/documentos', 'matriz-documentos'],
    ['/documentos/nfe', 'matriz-nfe'],
    ['/commodities', 'matriz-commodities'],
    ['/cadastros/compradores', 'matriz-compradores'],
    ['/cadastros/vendedores', 'matriz-vendedores'],
    ['/cadastros/fazendas', 'matriz-fazendas'],
    ['/atendimento', 'matriz-atendimento'],
    ['/atendimento/faturamento', 'matriz-atendimento-faturamento'],
    ['/atendimento/suporte', 'matriz-atendimento-suporte'],
    ['/atendimento/indicadores', 'matriz-atendimento-indicadores'],
    ['/atendimento/equipe', 'matriz-atendimento-equipe'],
    ['/gestao/ciclo', 'matriz-gestao-ciclo'],
    ['/gestao/relatorios', 'matriz-relatorios'],
    ['/gestao/auditoria', 'matriz-auditoria'],
    ['/gestao/usuarios', 'matriz-usuarios'],
    ['/gestao/papeis', 'matriz-papeis'],
    ['/gestao/organizacoes', 'matriz-grupos'],
    ['/configuracoes/seguranca', 'matriz-seguranca'],
    ['/configuracoes/workflow', 'matriz-workflow'],
    ['/configuracoes/parametros', 'matriz-parametros'],
    ['/conta/seguranca', 'preferencias'],
  ] as const) {
    await visit(matriz, url, name);
  }

  // ─── Perfis da Matriz com menu próprio ───
  for (const [email, name] of [
    ['operador@graoforte.demo', 'operador-visao-geral'],
    ['faturamento@graoforte.demo', 'faturamento-visao-geral'],
    ['suporte@graoforte.demo', 'atendente-visao-geral'],
    ['gestor@graoforte.demo', 'gestor-visao-geral'],
  ] as const) {
    const page = await session(browser, email);
    await visit(page, '/', name);
    if (name === 'faturamento-visao-geral') await visit(page, '/ordens?status=PENDING_BILLING', 'faturamento-solicitacoes');
    if (name === 'atendente-visao-geral') await visit(page, '/atendimento/suporte', 'atendente-fila');
    await page.context().close();
  }

  // ─── Atendimento pelo portal (janela de conversa) ───
  await comprador.goto('/');
  await comprador.getByRole('button', { name: /atendimento/i }).last().click();
  await shot(comprador, 'comprador-atendimento');
});
