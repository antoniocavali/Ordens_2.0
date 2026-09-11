// Capturas das telas de logística. Uso: node scripts/screens-logistics.mjs <senha> <pasta-destino>
import { chromium } from '@playwright/test';

const [password, outDir = '.'] = process.argv.slice(2);
const BASE = process.env.WEB_URL ?? 'http://localhost:3020';
const browser = await chromium.launch();
const errors = [];

async function session(viewport, theme = 'light') {
  const context = await browser.newContext({ viewport, colorScheme: theme });
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && errors.push(`[console] ${m.text()}`));
  await page.goto(`${BASE}/login`);
  await page.getByLabel('E-mail').fill('admin@graoforte.demo');
  await page.getByLabel('Senha', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL(`${BASE}/`);
  return { context, page };
}

const shot = (page, name) => page.screenshot({ path: `${outDir}/${name}.png` });

const { context, page } = await session({ width: 1600, height: 1000 });

await page.goto(`${BASE}/agendamentos`);
await page.getByRole('heading', { name: 'Agendamentos' }).waitFor();
await page.waitForTimeout(1500);
await shot(page, 'agendamentos-semana');
await page.getByRole('tab', { name: 'Lista' }).click();
await page.waitForTimeout(1000);
await shot(page, 'agendamentos-lista');
await page.getByRole('button', { name: 'Novo agendamento' }).click();
await page.waitForTimeout(1200);
await shot(page, 'agendamentos-drawer-novo');
await page.keyboard.press('Escape');

await page.goto(`${BASE}/cargas`);
await page.waitForSelector('tbody tr td');
await page.waitForTimeout(1200);
await shot(page, 'cargas-lista');
await page.locator('tbody tr').first().click();
await page.getByText('Histórico').first().waitFor();
await page.waitForTimeout(1200);
await shot(page, 'cargas-drawer');
await page.keyboard.press('Escape');

// Clique na linha abre o quick view; vai direto ao detalhe de uma OC em execução.
const orderId = await page.evaluate(async () => {
  const res = await fetch('/api/orders?status=IN_PROGRESS&pageSize=10', { credentials: 'include' });
  return (await res.json()).items?.[0]?.id;
});
await page.goto(`${BASE}/ordens/${orderId}`);
await page.getByRole('tab', { name: 'Cargas' }).click();
await page.waitForTimeout(1500);
await shot(page, 'ordem-aba-cargas');
await context.close();

const dark = await session({ width: 1600, height: 1000 }, 'dark');
await dark.page.goto(`${BASE}/cargas`);
await dark.page.waitForSelector('tbody tr td');
await dark.page.waitForTimeout(1200);
await shot(dark.page, 'cargas-lista-dark');
await dark.context.close();

const mobile = await session({ width: 400, height: 860 });
await mobile.page.goto(`${BASE}/agendamentos`);
await mobile.page.getByRole('heading', { name: 'Agendamentos' }).waitFor();
await mobile.page.waitForTimeout(1500);
await shot(mobile.page, 'agendamentos-mobile');
await mobile.context.close();

await browser.close();
console.log(errors.length ? errors.join('\n') : 'sem erros no console');
console.log('ok');
