import { expect, test } from '@playwright/test';
import { api, loginAs, login, password } from './helpers';

/**
 * Atendimento: cliente abre o chat → assistente direciona para Faturamento → fila →
 * atendente responde pelo painel (nota interna invisível ao cliente) → cliente recebe em tempo real → resolução.
 */
test.describe('Atendimento', () => {
  test.skip(!password, 'Defina E2E_PASSWORD com a senha demo');

  test('assistente direciona para o Faturamento e o atendente responde pelo painel', async ({ page, browser }) => {
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

    // Cliente não acessa o painel da equipe.
    expect((await api(page, 'GET', '/support/queue')).status).toBe(403);

    const agent = await loginAs(browser, 'operador@graoforte.demo');
    await agent.page.goto('/suporte');
    await expect(agent.page.getByRole('heading', { name: 'Atendimento' })).toBeVisible();
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

  test('Fazenda usa o chat, mas não vê o painel da equipe', async ({ page }) => {
    await login(page, 'fazenda.maria@graoforte.demo');
    await expect(page.getByRole('button', { name: /^Abrir atendimento/ })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Atendimento' })).toHaveCount(0);
    expect((await api(page, 'GET', '/support/queue')).status).toBe(403);
    expect((await api(page, 'GET', '/support/summary')).status).toBe(403);
  });
});
