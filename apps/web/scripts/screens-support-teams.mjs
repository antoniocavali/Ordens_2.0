// Capturas dos painéis dos times de atendimento e dos indicadores.
// Uso: node scripts/screens-support-teams.mjs <senha> <pasta-destino>
import { mkdirSync } from 'node:fs';
import { chromium } from '@playwright/test';

const [password, outDir] = process.argv.slice(2);
if (!password || !outDir) {
  console.error('Uso: node scripts/screens-support-teams.mjs <senha> <pasta-destino>');
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
const shot = async (page, name, fullPage = false) => {
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${outDir}/${name}.png`, fullPage });
  console.log('ok', name);
};

const billing = await session('faturamento@graoforte.demo');
await billing.page.goto(`${BASE}/atendimento/faturamento`);
await billing.page.getByRole('heading', { name: 'Atendimento · Faturamento' }).waitFor();
await billing.page.getByRole('button', { name: 'Resolvidas hoje' }).first().waitFor();
const first = billing.page.locator('ul.divide-y > li button').first();
if (await first.count()) await first.click();
await shot(billing.page, 'time-faturamento');
await billing.page.goto(`${BASE}/atendimento/indicadores`);
await billing.page.getByRole('heading', { name: /Indicadores/ }).waitFor();
await billing.page.getByText('Volume diário').waitFor();
await shot(billing.page, 'indicadores-faturamento', true);
await billing.context.close();

const support = await session('suporte@graoforte.demo');
await support.page.goto(`${BASE}/atendimento/suporte`);
await support.page.getByRole('heading', { name: 'Atendimento · Suporte' }).waitFor();
await shot(support.page, 'time-suporte');
await support.page.goto(`${BASE}/atendimento/faturamento`);
await support.page.getByText('Sem acesso a este painel').waitFor();
await shot(support.page, 'suporte-sem-acesso-faturamento');
await support.context.close();

const manager = await session('gestor@graoforte.demo');
await manager.page.goto(`${BASE}/atendimento/indicadores?periodo=30`);
await manager.page.getByText('Comparativo das filas').waitFor();
await shot(manager.page, 'indicadores-supervisao', true);
await manager.page.goto(`${BASE}/atendimento`);
await manager.page.getByRole('heading', { name: 'Atendimento · Visão geral' }).waitFor();
await shot(manager.page, 'visao-geral');
await manager.page.goto(`${BASE}/atendimento/equipe`);
await manager.page.getByRole('heading', { name: 'Equipe do atendimento' }).waitFor();
await manager.page.getByRole('switch').first().waitFor();
await shot(manager.page, 'equipe');
await manager.context.close();

const mobile = await session('gestor@graoforte.demo', { width: 390, height: 844 });
await mobile.page.goto(`${BASE}/atendimento/indicadores`);
await mobile.page.getByText('Volume diário').waitFor();
await shot(mobile.page, 'indicadores-mobile', true);
await mobile.context.close();

await browser.close();
console.log(errors.length ? `\nErros de console:\n${errors.join('\n')}` : '\nSem erros de console');
