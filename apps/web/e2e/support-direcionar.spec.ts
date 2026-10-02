import { expect, test } from '@playwright/test';
import { api, apiOk, login, loginAs, password } from './helpers';

/**
 * Direcionar a conversa para qualquer pessoa da Matriz que atenda — Operador e Atendente inclusive,
 * mesmo que a fila da conversa não seja uma das que ela recebe pela equipe. Quem recebe consegue
 * abrir e responder, mas continua sem enxergar a fila inteira.
 */
test.describe('Direcionar atendimento', () => {
  test.skip(!password, 'Defina E2E_PASSWORD com a senha demo');

  test('Atendente de outra fila pode receber a conversa e responder, sem ganhar a fila', async ({ page, browser }) => {
    // Conversa do comprador na fila de Faturamento.
    await login(page, 'comprador.abc@graoforte.demo');
    const subject = `Direcionamento ${Date.now()}`;
    const created = await apiOk(page, 'POST', '/support/conversations', {});
    await apiOk(page, 'POST', `/support/conversations/${created.id}/messages`, { quickReply: 'BILLING' });
    await apiOk(page, 'POST', `/support/conversations/${created.id}/messages`, { body: subject });

    // Marcos é Atendente e, na equipe, recebe só Suporte — não Faturamento.
    const supervisor = await loginAs(browser, 'admin@graoforte.demo');
    const agents = ((await apiOk(supervisor.page, 'GET', '/support/agents?queue=BILLING')) as { items: { id: string; label: string; description: string }[] }).items;
    const atendente = agents.find((a) => a.label === 'Marcos Teixeira');
    expect(atendente, 'Atendente aparece como opção mesmo fora da equipe desta fila').toBeTruthy();
    expect(atendente!.description).toBe('Atendente · fora da equipe desta fila');
    // Operador Matriz também é opção; este já recebe Faturamento pela equipe, então vem antes.
    const operador = agents.find((a) => a.label === 'Bruna Costa');
    expect(operador?.description).toBe('Operador Matriz');
    expect(agents.indexOf(operador!)).toBeLessThan(agents.indexOf(atendente!));

    await apiOk(supervisor.page, 'POST', `/support/conversations/${created.id}/assign`, { assigneeUserId: atendente!.id });
    await supervisor.context.close();

    // ─── Quem recebeu consegue abrir e responder ───
    const marcos = await loginAs(browser, 'suporte@graoforte.demo');
    const detail = await apiOk(marcos.page, 'GET', `/support/conversations/${created.id}`);
    expect(detail.number).toBe(created.number);
    await apiOk(marcos.page, 'POST', `/support/conversations/${created.id}/messages`, { body: 'Assumi este caso, já verifico' });

    // Aparece em "Em atendimento" no balão, mesmo sendo de outra fila.
    await marcos.page.goto('/');
    await marcos.page.getByRole('button', { name: /^Abrir atendimento/ }).click();
    const chat = marcos.page.getByRole('dialog', { name: 'Atendimento' });
    await chat.getByRole('tab', { name: /Em atendimento/ }).click();
    await expect(chat.locator('li').filter({ hasText: subject })).toBeVisible({ timeout: 15_000 });

    // Mas continua sem a fila de Faturamento: direcionar não dá acesso ao resto dela.
    expect((await api(marcos.page, 'GET', '/support/queue?queue=BILLING')).status).toBe(403);
    await marcos.context.close();

    // O cliente recebe a resposta normalmente.
    const comoCliente = await apiOk(page, 'GET', `/support/conversations/${created.id}`);
    expect(comoCliente.messages.some((m: any) => m.body === 'Assumi este caso, já verifico')).toBe(true);
  });
});
