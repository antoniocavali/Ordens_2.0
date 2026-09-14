// Capturas da gestão de usuários: lista, convite e edição de acesso.
// Uso: node scripts/screens-users.mjs <senha> <pasta-destino>
import { mkdirSync } from 'node:fs';
import { chromium } from '@playwright/test';

const [password, outDir] = process.argv.slice(2);
if (!password || !outDir) {
  console.error('Uso: node scripts/screens-users.mjs <senha> <pasta-destino>');
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });
const BASE = process.env.WEB_URL ?? 'http://localhost:3020';
const browser = await chromium.launch();
const errors = [];

async function session(email, viewport = { width: 1600, height: 1000 }) {
  const context = await browser.newContext({ viewport, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' });
  const page = await context.newPage();
  page.on('console', (m) => m.type() === 'error' && errors.push(`${email}: ${m.text()}`));
  await page.goto(`${BASE}/login`);
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL(`${BASE}/`);
  return { context, page };
}
const shot = async (page, name) => {
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${outDir}/${name}.png` });
  console.log('ok', name);
};

const admin = await session('admin@graoforte.demo');
await admin.page.goto(`${BASE}/gestao/usuarios`);
await admin.page.getByRole('heading', { name: 'Usuários' }).waitFor();
await admin.page.locator('tbody tr').first().waitFor();
await shot(admin.page, 'usuarios-lista');

await admin.page.getByRole('button', { name: 'Convidar usuário' }).click();
const invite = admin.page.getByRole('dialog', { name: 'Convidar usuário' });
await invite.getByLabel('Nome').fill('Nova Pessoa');
await invite.getByLabel('E-mail').fill('nova.pessoa@graoforte.demo');
const orgSelect = invite.getByLabel('Organização');
const firstOrg = await orgSelect.locator('option').nth(1).getAttribute('value');
await orgSelect.selectOption(firstOrg);
await invite.getByRole('checkbox').nth(2).check();
await shot(admin.page, 'usuarios-convite');
await invite.getByRole('button', { name: 'Cancelar' }).click();

await admin.page.getByRole('row', { name: /Bruna Costa/ }).click();
await admin.page.getByRole('dialog', { name: 'Bruna Costa' }).waitFor();
await shot(admin.page, 'usuarios-edicao');
await admin.context.close();

const farm = await session('fazenda.joao@graoforte.demo');
await farm.page.goto(`${BASE}/gestao/usuarios`);
await farm.page.getByRole('heading', { name: 'Usuários' }).waitFor();
await shot(farm.page, 'usuarios-fazenda');
await farm.context.close();

const mobile = await session('admin@graoforte.demo', { width: 390, height: 844 });
await mobile.page.goto(`${BASE}/gestao/usuarios`);
await mobile.page.getByRole('heading', { name: 'Usuários' }).waitFor();
await shot(mobile.page, 'usuarios-mobile');
await mobile.context.close();

await browser.close();
console.log(errors.length ? `\nErros de console:\n${errors.join('\n')}` : '\nSem erros de console');
