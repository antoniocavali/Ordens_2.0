import { expect, test } from '@playwright/test';
import { api, apiOk, login, password } from './helpers';

/**
 * Passkeys com autenticador virtual do Chromium (CDP WebAuthn): cadastro com senha, login sem senha
 * nem código 2FA, auditoria e remoção.
 */
test.describe('Passkeys', () => {
  test.skip(!password, 'Defina E2E_PASSWORD com a senha demo');
  test.skip(({ browserName }) => browserName !== 'chromium', 'Autenticador virtual só no Chromium');

  test('cadastra, entra sem senha e remove', async ({ page, context }) => {
    const cdp = await context.newCDPSession(page);
    await cdp.send('WebAuthn.enable');
    await cdp.send('WebAuthn.addVirtualAuthenticator', {
      options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
    });

    await login(page, 'gestor@graoforte.demo');
    // Limpa sobras de execuções anteriores.
    for (const p of (await apiOk(page, 'GET', '/auth/passkeys')) as any[]) await apiOk(page, 'DELETE', `/auth/passkeys/${p.id}`);

    // Cadastro exige a senha atual.
    expect((await api(page, 'POST', '/auth/passkeys/register/options', { password: 'senha-errada-123' })).status).toBe(422);

    await page.goto('/conta/seguranca');
    await page.getByRole('button', { name: 'Adicionar passkey' }).click();
    const form = page.getByRole('form', { name: 'Nova passkey' });
    await form.getByLabel('Nome').fill('Passkey E2E');
    await form.getByLabel('Senha atual').fill(password);
    await form.getByRole('button', { name: 'Cadastrar neste aparelho' }).click();
    const list = page.getByRole('list', { name: 'Passkeys cadastradas' });
    await expect(list.getByText('Passkey E2E')).toBeVisible();

    // Sai e entra só com a passkey.
    await apiOk(page, 'POST', '/auth/logout');
    await page.context().clearCookies();
    await page.goto('/login');
    await page.getByRole('button', { name: 'Entrar com passkey' }).click();
    await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 });
    const me = await apiOk(page, 'GET', '/auth/me');
    expect(me).toMatchObject({ stage: 'ACTIVE', user: { email: 'gestor@graoforte.demo' } });
    expect(((await apiOk(page, 'GET', '/auth/login-history')) as any[])[0].result).toBe('PASSKEY_SUCCESS');

    // Desafio é de uso único: resposta forjada com desafio inexistente é recusada.
    expect((await api(page, 'POST', '/auth/passkeys/login', { challengeId: 'x'.repeat(32), response: { id: 'abc', rawId: 'abc', type: 'public-key', response: { clientDataJSON: 'e30' } } })).status).toBe(422);

    // Renomeia e remove.
    await page.goto('/conta/seguranca');
    await list.getByRole('button', { name: 'Renomear Passkey E2E' }).click();
    await list.getByLabel('Novo nome').fill('Notebook E2E');
    await list.getByRole('button', { name: 'Salvar' }).click();
    await expect(list.getByText('Notebook E2E')).toBeVisible();
    await list.getByRole('button', { name: 'Remover Notebook E2E' }).click();
    await page.getByRole('button', { name: 'Remover', exact: true }).click();
    await expect(page.getByText('Nenhuma passkey cadastrada.')).toBeVisible();

    const audit = await apiOk(page, 'GET', '/audit?action=auth.passkey.added&pageSize=5');
    expect((audit.items as any[]).length).toBeGreaterThan(0);

    // Passkey removida não entra mais.
    await apiOk(page, 'POST', '/auth/logout');
    await page.context().clearCookies();
    await page.goto('/login');
    await page.getByRole('button', { name: 'Entrar com passkey' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Passkey não reconhecida' })).toBeVisible();
  });
});
