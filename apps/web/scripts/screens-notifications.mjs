// Captura do menu de notificações. Uso: node scripts/screens-notifications.mjs <senha> <pasta-destino>
import { chromium } from '@playwright/test';

const [password, outDir = '.'] = process.argv.slice(2);
const BASE = process.env.WEB_URL ?? 'http://localhost:3020';
const browser = await chromium.launch();
const errors = [];

async function capture(email, name, viewport = { width: 1600, height: 1000 }) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(`[pageerror ${name}] ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && !/favicon|401/.test(m.text()) && errors.push(`[console ${name}] ${m.text()}`));
  await page.goto(`${BASE}/login`);
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL(`${BASE}/`, { timeout: 60_000 });
  await page.getByRole('button', { name: /^Notificações/ }).click();
  await page.getByText('Notificações', { exact: true }).waitFor();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${outDir}/${name}.png` });
  await context.close();
}

await capture('admin@graoforte.demo', 'sino-matriz');
await capture('fazenda.joao@graoforte.demo', 'sino-fazenda');
await capture('comprador.abc@graoforte.demo', 'sino-mobile', { width: 400, height: 860 });

await browser.close();
console.log(errors.length ? errors.join('\n') : 'sem erros no console');
console.log('ok');
