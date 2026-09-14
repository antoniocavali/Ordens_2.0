// Capturas do chat de atendimento e do painel de suporte. Uso: node scripts/screens-support.mjs <senha> <pasta-destino>
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
  await page.waitForURL(`${BASE}/`, { timeout: 60_000 });
  return { context, page };
}
const shot = (page, name) => page.screenshot({ path: `${outDir}/${name}.png` });

// Cliente (Fazenda): nova conversa com o assistente.
const farm = await session('fazenda.joao@graoforte.demo');
await farm.page.getByRole('button', { name: /Abrir atendimento/ }).click();
await farm.page.getByRole('dialog', { name: 'Atendimento' }).waitFor();
await farm.page.waitForTimeout(800);
await shot(farm.page, 'chat-lista');
await farm.page.getByRole('button', { name: 'Nova conversa' }).click();
await farm.page.getByRole('group', { name: 'Respostas rápidas' }).waitFor();
await farm.page.waitForTimeout(800);
await shot(farm.page, 'chat-assistente');
await farm.page.getByRole('button', { name: /^Faturamento/ }).click();
await farm.page.getByText(/Descreva em poucas palavras/).waitFor();
await farm.page.getByRole('textbox', { name: 'Mensagem' }).fill('A NF-e da ordem 2026/00033 veio com o peso diferente da carga');
await farm.page.keyboard.press('Enter');
await farm.page.getByText(/está na fila de Faturamento/).waitFor();
await farm.page.waitForTimeout(1000);
await shot(farm.page, 'chat-na-fila');
await farm.context.close();

// Atendente (Matriz): painel com a conversa selecionada, resposta e nota interna.
const agent = await session('admin@graoforte.demo');
await agent.page.goto(`${BASE}/atendimento`);
await agent.page.getByRole('heading', { name: 'Atendimento' }).waitFor();
await agent.page.locator('ul li button').first().click();
await agent.page.getByRole('textbox', { name: 'Mensagem' }).waitFor();
await agent.page.getByRole('textbox', { name: 'Mensagem' }).fill('Olá João! Já estou conferindo a nota com o fiscal.');
await agent.page.keyboard.press('Enter');
await agent.page.getByText('Já estou conferindo').waitFor();
await agent.page.getByRole('radio', { name: 'Nota interna' }).click();
await agent.page.getByRole('textbox', { name: 'Mensagem' }).fill('Peso da NF-e 37.500 kg x líquido 37.000 kg. Verificar balança da fazenda.');
await agent.page.keyboard.press('Enter');
await agent.page.getByText('Verificar balança').waitFor();
await agent.page.waitForTimeout(1200);
await shot(agent.page, 'painel-suporte');
await agent.context.close();

const mobile = await session('comprador.nutri@graoforte.demo', { width: 400, height: 860 });
await mobile.page.getByRole('button', { name: /Abrir atendimento/ }).click();
await mobile.page.getByRole('dialog', { name: 'Atendimento' }).waitFor();
await mobile.page.locator('[role="dialog"] ul li button').first().click().catch(() => {});
await mobile.page.waitForTimeout(1500);
await shot(mobile.page, 'chat-mobile');
await mobile.context.close();

await browser.close();
console.log(errors.length ? errors.join('\n') : 'sem erros no console');
console.log('ok');
