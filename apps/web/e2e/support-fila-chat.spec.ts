import { expect, test } from '@playwright/test';
import { apiOk, login, loginAs, password } from './helpers';

/**
 * Atendente pega a conversa da fila pelo próprio balão do chat, sem ir ao painel: a aba "Na fila" só
 * aparece para quem atende, e assumir já abre a conversa em modo de atendente (com nota interna).
 */
test.describe('Fila no chat do atendente', () => {
  test.skip(!password, 'Defina E2E_PASSWORD com a senha demo');

  test('atendente assume pela aba "Na fila" e responde ali mesmo; cliente não vê a aba', async ({ page, browser }) => {
    // Cliente deixa uma conversa esperando no Faturamento.
    await login(page, 'comprador.abc@graoforte.demo');
    const subject = `Divergência na fatura ${Date.now()}`;
    const created = await apiOk(page, 'POST', '/support/conversations', {});
    await apiOk(page, 'POST', `/support/conversations/${created.id}/messages`, { quickReply: 'BILLING' });
    await apiOk(page, 'POST', `/support/conversations/${created.id}/messages`, { body: subject });

    // Quem só usa o chat não enxerga fila nenhuma.
    await page.goto('/');
    await page.getByRole('button', { name: /^Abrir atendimento/ }).click();
    const chatCliente = page.getByRole('dialog', { name: 'Atendimento' });
    await expect(chatCliente.getByRole('tab', { name: /Na fila/ })).toHaveCount(0);
    await expect(chatCliente.getByRole('tab', { name: /Em atendimento/ })).toHaveCount(0);

    // ─── Atendente de Faturamento, em qualquer tela do sistema ───
    const agente = await loginAs(browser, 'faturamento@graoforte.demo');
    await agente.page.goto('/ordens');
    await agente.page.getByRole('button', { name: /^Abrir atendimento/ }).click();
    const chat = agente.page.getByRole('dialog', { name: 'Atendimento' });

    await chat.getByRole('tab', { name: /Na fila/ }).click();
    const item = chat.locator('li').filter({ hasText: subject });
    await expect(item).toBeVisible({ timeout: 15_000 });

    const assumed = agente.page.waitForResponse((r) => r.url().includes(`/support/conversations/${created.id}/assign`) && r.request().method() === 'POST');
    await item.getByRole('button', { name: 'Assumir' }).click();
    expect((await assumed).ok()).toBe(true);

    // A conversa abre como atendente: dá para escrever nota interna sem sair do balão.
    await expect(chat.getByRole('radio', { name: 'Nota interna' })).toBeVisible();
    await chat.getByRole('textbox', { name: 'Mensagem' }).fill('Estou verificando o boleto');
    await chat.getByRole('button', { name: 'Enviar mensagem' }).click();
    await expect(chat.getByText('Estou verificando o boleto')).toBeVisible();

    // Depois de assumir, a conversa passa a aparecer em "Em atendimento".
    await chat.getByRole('button', { name: 'Voltar para as conversas' }).click();
    await chat.getByRole('tab', { name: /Em atendimento/ }).click();
    await expect(chat.locator('li').filter({ hasText: subject })).toBeVisible({ timeout: 15_000 });
    // E some da fila, que agora está vazia para esta conversa.
    await chat.getByRole('tab', { name: /Na fila/ }).click();
    await expect(chat.locator('li').filter({ hasText: subject })).toHaveCount(0);

    const detail = await apiOk(agente.page, 'GET', `/support/conversations/${created.id}`);
    expect(detail.assignee?.name, 'assumida pelo atendente').toBeTruthy();
    expect(detail.status).toBe('OPEN');
    await agente.context.close();

    // O cliente recebe a resposta na própria conversa.
    const comoCliente = await apiOk(page, 'GET', `/support/conversations/${created.id}`);
    expect(comoCliente.messages.some((m: any) => m.body === 'Estou verificando o boleto')).toBe(true);
  });
});
