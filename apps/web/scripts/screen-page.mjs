// Captura uma página (e opcionalmente abre a primeira linha). Uso: node scripts/screen-page.mjs <senha> <rota> <arquivo> [abrir]
import { chromium } from '@playwright/test';

const [password, route, file, open] = process.argv.slice(2);
const BASE = process.env.WEB_URL ?? 'http://localhost:3020';
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`${BASE}/login`);
await page.getByLabel('E-mail').fill('admin@graoforte.demo');
await page.getByLabel('Senha', { exact: true }).fill(password);
await page.getByRole('button', { name: 'Entrar' }).click();
await page.waitForURL(`${BASE}/`);
await page.goto(`${BASE}${route}`);
await page.waitForSelector('tbody tr td');
await page.waitForTimeout(1500);
await page.screenshot({ path: file });
if (open) {
  await page.locator('tbody tr').first().click();
  await page.waitForTimeout(2000);
  await page.screenshot({ path: file.replace('.png', '-drawer.png') });
}
await browser.close();
console.log('ok');
