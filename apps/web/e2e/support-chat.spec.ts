import { expect, test } from '@playwright/test';
import { api, apiOk, loginAs, login, password } from './helpers';

/**
 * Atendimento: cliente abre o chat → assistente direciona para Faturamento → fila do time →
 * atendente de Faturamento responde pelo painel do time (nota interna invisível ao cliente) →
 * cliente recebe em tempo real → resolução. Times só enxergam a própria fila; indicadores recortados.
 */
test.describe('Atendimento', () => {
  test.skip(!password, 'Defina E2E_PASSWORD com a senha demo');

  test('assistente direciona para o Faturamento e o time responde pelo próprio painel', async ({ page, browser }) => {
    await login(page, 'comprador.abc@graoforte.demo');

    await page.getByRole('button', { name: /^Abrir atendimento/ }).click();
    const chat = page.getByRole('dialog', { name: 'Atendimento' });
    await chat.getByRole('button', { name: 'Nova conversa' }).click();
    await expect(chat.getByText(/Sobre o que você precisa de ajuda\?/)).toBeVisible();

    await chat.getByRole('button', { name: /^Faturamento/ }).click();
    await expect(chat.getByText(/Descreva em poucas palavras/)).toBeVisible();

    const subject = `Boleto com valor divergente ${Date.now()}`;
    await chat.getByRole('textbox', { name: 'Mensagem' }).fill(subject);
    await chat.getByRole('textbox', { name: 'Mensagem' }).press('Enter');
    await expect(chat.getByText(/está na fila de Faturamento/)).toBeVisible();
    await expect(chat.getByText('Aguardando atendente').first()).toBeVisible();

    const header = await chat.getByText(/^Atendimento ATD-\d{4}-\d{4}$/).textContent();
    const number = header!.replace('Atendimento ', '').trim();
    const conversationId = ((await apiOk(page, 'GET', '/support/conversations')) as { id: string; number: string }[]).find((c) => c.number === number)!.id;

    // Cliente não acessa o painel da equipe.
    expect((await api(page, 'GET', '/support/queue')).status).toBe(403);

    // Time de Suporte não enxerga a conversa de Faturamento.
    const supportAgent = await loginAs(browser, 'suporte@graoforte.demo');
    expect((await api(supportAgent.page, 'GET', `/support/conversations/${conversationId}`)).status).toBe(404);
    await supportAgent.page.goto('/atendimento/faturamento');
    await expect(supportAgent.page.getByText('Sem acesso a este painel')).toBeVisible();
    await supportAgent.context.close();

    const agent = await loginAs(browser, 'faturamento@graoforte.demo');
    await agent.page.goto('/atendimento/faturamento');
    await expect(agent.page.getByRole('heading', { name: 'Atendimento · Faturamento' })).toBeVisible();
    await agent.page.getByLabel('Buscar atendimentos').fill(number);
    await agent.page.getByRole('button', { name: new RegExp(number) }).click();

    const composer = agent.page.getByRole('textbox', { name: 'Mensagem' });
    await agent.page.getByRole('radio', { name: 'Nota interna' }).click();
    const note = 'Conferir boleto no ERP antes de responder';
    await composer.fill(note);
    await composer.press('Enter');
    await expect(agent.page.getByText(note)).toBeVisible();

    await agent.page.getByRole('radio', { name: 'Responder ao cliente' }).click();
    const reply = 'Olá! Já corrigimos o valor e reenviamos o boleto.';
    await composer.fill(reply);
    await composer.press('Enter');
    await expect(agent.page.getByText(reply)).toBeVisible();
    // A primeira resposta pública atribui ao atendente e inicia o atendimento.
    await expect(agent.page.getByRole('button', { name: 'Assumir' })).toHaveCount(0);
    await expect(agent.page.getByText('Em atendimento').first()).toBeVisible();

    // Cliente recebe a resposta sem recarregar; nota interna nunca aparece.
    await expect(chat.getByText(reply)).toBeVisible({ timeout: 30_000 });
    await expect(chat.getByText(note)).toHaveCount(0);

    await agent.page.getByRole('button', { name: 'Resolver', exact: true }).click();
    await expect(chat.getByText('Resolvida').first()).toBeVisible({ timeout: 30_000 });
    await agent.context.close();
  });

  test('indicadores: time vê só a própria fila, supervisão compara as filas', async ({ page, browser }) => {
    await login(page, 'faturamento@graoforte.demo');
    await page.goto('/atendimento/indicadores');
    await expect(page.getByRole('heading', { name: 'Indicadores · Faturamento' })).toBeVisible();
    await expect(page.getByText('Volume diário · 30 dias')).toBeVisible();
    await expect(page.getByRole('radiogroup', { name: 'Fila' })).toHaveCount(0);
    await expect(page.getByText('Comparativo das filas')).toHaveCount(0);
    const own = await apiOk(page, 'GET', '/support/analytics?days=7');
    expect(own.queues).toEqual(['BILLING']);
    expect((await api(page, 'GET', '/support/analytics?queue=SUPPORT')).status).toBe(403);

    await page.getByRole('radio', { name: '7 dias' }).click();
    await expect(page.getByText('Volume diário · 7 dias')).toBeVisible();

    const manager = await loginAs(browser, 'gestor@graoforte.demo');
    await manager.page.goto('/atendimento/indicadores');
    await expect(manager.page.getByRole('heading', { name: 'Indicadores de atendimento' })).toBeVisible();
    await expect(manager.page.getByText('Comparativo das filas')).toBeVisible();
    await expect(manager.page.getByText('Desistências no assistente')).toBeVisible();
    await manager.page.getByRole('radiogroup', { name: 'Fila' }).getByRole('radio', { name: 'Suporte' }).click();
    await expect(manager.page).toHaveURL(/fila=SUPPORT/);
    await expect(manager.page.getByText('Comparativo das filas')).toHaveCount(0);
    await manager.context.close();
  });

  test('Fazenda usa o chat, mas não vê painéis nem indicadores', async ({ page }) => {
    await login(page, 'fazenda.maria@graoforte.demo');
    await expect(page.getByRole('button', { name: /^Abrir atendimento/ })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Indicadores' })).toHaveCount(0);
    for (const path of ['/support/queue', '/support/summary', '/support/analytics']) {
      expect((await api(page, 'GET', path)).status, path).toBe(403);
    }
  });
});
