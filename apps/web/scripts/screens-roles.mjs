// Capturas de papéis e permissões, concessão individual e senha provisória.
// Uso: node scripts/screens-roles.mjs <senha> <pasta-destino>
import { mkdirSync } from 'node:fs';
import { chromium } from '@playwright/test';

const [password, outDir] = process.argv.slice(2);
if (!password || !outDir) {
  console.error('Uso: node scripts/screens-roles.mjs <senha> <pasta-destino>');
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
await admin.page.goto(`${BASE}/gestao/papeis`);
await admin.page.getByRole('heading', { name: 'Papéis e permissões' }).waitFor();
await admin.page.getByRole('button', { name: /Ver permissões|Editar/ }).first().waitFor();
await shot(admin.page, 'papeis-lista');

await admin.page.getByRole('button', { name: 'Ver permissões' }).first().click();
await admin.page.getByRole('dialog').waitFor();
await shot(admin.page, 'papeis-sistema');
await admin.page.keyboard.press('Escape');
await admin.page.getByRole('dialog').waitFor({ state: 'detached' });

await admin.page.getByRole('button', { name: 'Novo papel' }).click();
const editor = admin.page.getByRole('dialog', { name: 'Novo papel' });
await editor.getByLabel('Nome').fill('Conferência fiscal');
await editor.getByLabel('Descrição').fill('Consulta cargas e NF-e e envia documentos');
for (const label of [/^Visualizar cargas/, /^Visualizar documentos/, /^Enviar NF-e/, /^Visualizar ordens/]) {
  await editor.getByRole('checkbox', { name: label }).check();
}
await shot(admin.page, 'papeis-novo');
await editor.getByRole('button', { name: 'Cancelar' }).click();

await admin.page.goto(`${BASE}/gestao/usuarios`);
await admin.page.getByRole('row', { name: /Bruna Costa/ }).click();
const drawer = admin.page.getByRole('dialog', { name: 'Bruna Costa' });
await drawer.getByRole('button', { name: 'Definir senha provisória' }).click();
await drawer.getByRole('button', { name: 'Gerar' }).click();
await drawer.getByText('Permissões individuais').scrollIntoViewIfNeeded();
await shot(admin.page, 'usuario-senha-concessao');
await admin.context.close();

// Tela de nova senha (sem sessão pendente mostra o formulário; o envio exige o estágio correto).
const anon = await browser.newContext({ viewport: { width: 1600, height: 1000 }, locale: 'pt-BR' });
const ap = await anon.newPage();
await ap.goto(`${BASE}/login/nova-senha`);
await ap.getByRole('heading', { name: 'Crie sua nova senha' }).waitFor();
await shot(ap, 'nova-senha');
await anon.close();

await browser.close();
console.log(errors.length ? `\nErros de console:\n${errors.join('\n')}` : '\nSem erros de console');
