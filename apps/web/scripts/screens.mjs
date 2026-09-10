// Captura telas do vertical slice para revisão visual. Uso: node scripts/screens.mjs <senha> <pasta-saida>
import { chromium } from '@playwright/test';

const [password, out = '.'] = process.argv.slice(2);
const BASE = process.env.WEB_URL ?? 'http://localhost:3020';

const browser = await chromium.launch();
for (const theme of ['light', 'dark']) {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, colorScheme: theme, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log(`[pageerror ${theme}]`, e.message));
  page.on('console', (m) => m.type() === 'error' && console.log(`[console ${theme}]`, m.text()));

  await page.goto(`${BASE}/login`);
  await page.screenshot({ path: `${out}/01-login-${theme}.png` });
  await page.getByLabel('E-mail').fill('admin@graoforte.demo');
  await page.getByLabel('Senha', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL(`${BASE}/`);
  await page.evaluate((t) => fetch('/api/me/preferences', { method: 'PATCH', headers: { 'content-type': 'application/json', 'x-csrf-token': document.cookie.match(/ordens_csrf=([^;]+)/)?.[1] ?? '' }, body: JSON.stringify({ theme: t }) }), theme);
  await page.reload();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${out}/02-home-${theme}.png` });

  await page.goto(`${BASE}/ordens`);
  await page.waitForSelector('tbody tr td a');
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${out}/03-ordens-${theme}.png` });

  if (theme === 'light') {
    await page.locator('tbody tr').nth(2).click();
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${out}/04-quickview-${theme}.png` });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  }

  try {
    await page.goto(`${BASE}/ordens?nova=1`);
    await page.waitForSelector('#secao-comercial', { timeout: 15000 });
    await page.waitForTimeout(800);
    // Cascata: vendedor → fazenda
    await page.locator('#secao-comercial [role="combobox"]').nth(1).click();
    await page.waitForTimeout(300);
    await page.keyboard.type('João');
    await page.waitForTimeout(1500);
    await page.keyboard.press('Enter');
    await page.locator('#secao-comercial [role="combobox"]').nth(2).click();
    await page.waitForTimeout(1500);
    await page.keyboard.press('Enter');
    await page.locator('#secao-quantidades input').first().fill('500');
    await page.locator('#secao-quantidades input').nth(1).fill('1.250,00');
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `${out}/05-drawer-${theme}.png` });
    await page.locator('#secao-origem-destino').scrollIntoViewIfNeeded();
    await page.locator('#secao-origem-destino [role="combobox"]').first().click();
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${out}/06-drawer-fazendas-${theme}.png` });
  } catch (err) {
    console.log(`[drawer ${theme}]`, err.message.split('\n')[0]);
    await page.screenshot({ path: `${out}/05-drawer-erro-${theme}.png` });
  }
  await ctx.close();
}

const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
const m = await mobile.newPage();
await m.goto(`${BASE}/login`);
await m.getByLabel('E-mail').fill('fazenda.joao@graoforte.demo');
await m.getByLabel('Senha', { exact: true }).fill(password);
await m.getByRole('button', { name: 'Entrar' }).click();
await m.waitForURL(`${BASE}/`);
await m.goto(`${BASE}/ordens`);
await m.waitForTimeout(2500);
await m.screenshot({ path: `${out}/07-mobile-fazenda.png` });
await browser.close();
console.log('ok');
