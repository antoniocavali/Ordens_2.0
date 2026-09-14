// Capturas dos cadastros. Uso: node scripts/screens-registry.mjs <senha> <pasta>
import { chromium } from '@playwright/test';

const [password, out = '.'] = process.argv.slice(2);
const BASE = process.env.WEB_URL ?? 'http://localhost:3020';

for (let i = 0; i < 90; i++) {
  try {
    if ((await fetch('http://localhost:4000/health/live')).ok) break;
  } catch {}
  await new Promise((r) => setTimeout(r, 1000));
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, colorScheme: 'light' });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`${BASE}/login`);
await page.getByLabel('E-mail').fill('admin@graoforte.demo');
await page.getByLabel('Senha', { exact: true }).fill(password);
await page.getByRole('button', { name: 'Entrar' }).click();
await page.waitForURL(`${BASE}/`);

const shots = [
  ['vendedores', '/cadastros/vendedores'],
  ['transportadoras', '/cadastros/transportadoras'],
  ['fazendas', '/cadastros/fazendas'],
  ['motoristas', '/cadastros/motoristas'],
  ['veiculos', '/cadastros/veiculos'],
];
for (const [name, path] of shots) {
  await page.goto(`${BASE}${path}`);
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${out}/r-${name}.png` });
}

await page.goto(`${BASE}/cadastros/vendedores`);
await page.waitForSelector('tbody tr');
await page.locator('tbody tr').first().click();
await page.waitForTimeout(2000);
await page.screenshot({ path: `${out}/r-vendedor-drawer.png` });
await page.keyboard.press('Escape');

await page.goto(`${BASE}/cadastros/transportadoras`);
await page.waitForSelector('tbody tr');
await page.locator('tbody tr').first().click();
await page.waitForTimeout(1500);
await page.mouse.wheel(0, 900);
await page.waitForTimeout(800);
await page.screenshot({ path: `${out}/r-transportadora-drawer.png` });
await browser.close();
console.log('ok');
