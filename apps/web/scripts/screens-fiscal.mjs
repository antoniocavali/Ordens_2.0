// Capturas da Fase 8 (NF-e, ocorrências, documentos). Uso: node scripts/screens-fiscal.mjs <senha> <pasta-destino>
import { chromium } from '@playwright/test';

const [password, outDir = '.'] = process.argv.slice(2);
const BASE = process.env.WEB_URL ?? 'http://localhost:3020';
const browser = await chromium.launch();
const errors = [];

async function session(email, viewport = { width: 1600, height: 1000 }) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(`[pageerror ${email}] ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && !/favicon|401/.test(m.text()) && errors.push(`[console ${email}] ${m.text()}`));
  await page.goto(`${BASE}/login`);
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL(`${BASE}/`);
  return { context, page };
}
const shot = (page, name) => page.screenshot({ path: `${outDir}/${name}.png` });
const api = (page, path) => page.evaluate(async (p) => (await fetch(`/api${p}`, { credentials: 'include' })).json(), path);

const admin = await session('admin@graoforte.demo');
const { page } = admin;
const invoices = await api(page, '/invoices?pageSize=20');
const sample = invoices.items.find((i) => i.status === 'VALID') ?? invoices.items[0];

await page.goto(`${BASE}/ocorrencias`);
await page.getByRole('heading', { name: 'Ocorrências' }).waitFor();
await page.getByRole('radio', { name: /Todas/ }).or(page.getByRole('button', { name: /^Todas/ })).first().click().catch(() => {});
await page.waitForTimeout(1500);
await shot(page, 'ocorrencias-lista');
await page.locator('ul li button').first().click();
await page.waitForTimeout(1500);
await shot(page, 'ocorrencias-drawer');
await page.keyboard.press('Escape');

await page.goto(`${BASE}/documentos/nfe`);
await page.waitForSelector('tbody tr td');
await page.waitForTimeout(1200);
await shot(page, 'nfe-lista');
await page.locator('tbody tr').first().click();
await page.waitForTimeout(1200);
await shot(page, 'nfe-drawer');
await page.keyboard.press('Escape');

await page.goto(`${BASE}/documentos`);
await page.getByRole('heading', { name: 'Central de Documentos' }).waitFor();
await page.waitForTimeout(1500);
await shot(page, 'documentos-central');

if (sample) {
  await page.goto(`${BASE}/cargas?abrir=${sample.load.id}`);
  await page.getByText('NF-e da carga').first().waitFor();
  await page.getByText('NF-e da carga').first().scrollIntoViewIfNeeded();
  await page.waitForTimeout(1500);
  await shot(page, 'carga-nfe-ocorrencias');

  await page.goto(`${BASE}/ordens/${sample.order.id}`);
  await page.getByRole('tab', { name: 'Ocorrências' }).click();
  await page.waitForTimeout(1500);
  await shot(page, 'ordem-aba-ocorrencias');
  await page.getByRole('tab', { name: 'Documentos' }).click();
  await page.waitForTimeout(1500);
  await shot(page, 'ordem-aba-documentos');
}
await admin.context.close();

const farm = await session('fazenda.joao@graoforte.demo');
await farm.page.goto(`${BASE}/ocorrencias`);
await farm.page.getByRole('heading', { name: 'Ocorrências' }).waitFor();
await farm.page.waitForTimeout(1500);
await shot(farm.page, 'fazenda-ocorrencias');
await farm.page.goto(`${BASE}/documentos`);
await farm.page.waitForTimeout(2000);
await shot(farm.page, 'fazenda-documentos');
await farm.context.close();

const mobile = await session('admin@graoforte.demo', { width: 400, height: 860 });
await mobile.page.goto(`${BASE}/ocorrencias`);
await mobile.page.getByRole('heading', { name: 'Ocorrências' }).waitFor();
await mobile.page.waitForTimeout(1500);
await shot(mobile.page, 'ocorrencias-mobile');
await mobile.context.close();

await browser.close();
console.log(errors.length ? errors.join('\n') : 'sem erros no console');
console.log('ok');
