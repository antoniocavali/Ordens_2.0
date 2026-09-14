import { expect, test } from '@playwright/test';
import { api, apiOk, login, password } from './helpers';

/** Criação direta de usuário com senha provisória (Q36): Gestor cria, sem escalar privilégios. */
test.describe('Criar usuário', () => {
  test.skip(!password, 'Defina E2E_PASSWORD com a senha demo');

  test('Gestor cria usuário com senha provisória e a pessoa troca a senha no primeiro acesso', async ({ page, browser }) => {
    const stamp = Date.now();
    await login(page, 'gestor@graoforte.demo');
    await page.goto('/gestao/usuarios');
    await expect(page.getByRole('button', { name: 'Convidar usuário' })).toHaveCount(0);

    const email = `criado.${stamp}@graoforte.demo`;
    await page.getByRole('button', { name: 'Criar usuário' }).click();
    const drawer = page.getByRole('dialog', { name: 'Criar usuário' });
    await drawer.getByLabel('Nome').fill('Pessoa Criada');
    await drawer.getByLabel('E-mail').fill(email);
    const provisional = await drawer.getByRole('textbox', { name: /^Senha provisória/ }).inputValue();
    expect(provisional.length).toBeGreaterThanOrEqual(12);
    const orgs = (await apiOk(page, 'GET', '/organizations')) as { id: string; kind: string }[];
    await drawer.getByLabel('Organização').selectOption(orgs.find((o) => o.kind === 'MATRIZ')!.id);
    // Gestor não vê o papel Administrador para atribuir.
    await expect(drawer.getByRole('checkbox', { name: /^Administrador Matriz/ })).toHaveCount(0);
    await drawer.getByRole('checkbox', { name: /^Operador Matriz/ }).check();
    await drawer.getByRole('button', { name: 'Criar usuário' }).click();
    await expect(page.getByText('Usuário Pessoa Criada criado')).toBeVisible();

    // Mesmo pela API, não atribui papel com permissões que o Gestor não tem.
    const matriz = orgs.find((o) => o.kind === 'MATRIZ')!;
    const escalation = await api(page, 'POST', '/users', {
      name: 'Tentativa Admin',
      email: `admin.${stamp}@graoforte.demo`,
      organizationId: matriz.id,
      roles: ['MATRIZ_ADMIN'],
      temporaryPassword: `Senha-${stamp}-abc!`,
    });
    expect(escalation.status).toBe(403);
    // E-mail já existente orienta a usar o convite.
    const duplicate = await api(page, 'POST', '/users', { name: 'Duplicado', email, organizationId: matriz.id, roles: ['MATRIZ_VIEWER'], temporaryPassword: `Senha-${stamp}-abc!` });
    expect(duplicate.status).toBe(422);

    const ctx = await browser.newContext();
    const np = await ctx.newPage();
    await np.goto('/login');
    await np.getByLabel('E-mail').fill(email);
    await np.getByLabel('Senha', { exact: true }).fill(provisional);
    await np.getByRole('button', { name: 'Entrar' }).click();
    await expect(np).toHaveURL(/\/login\/nova-senha/);
    const newPassword = `Pessoal-${stamp}-xyz!`;
    await np.getByLabel('Senha provisória').fill(provisional);
    await np.getByLabel('Nova senha', { exact: true }).fill(newPassword);
    await np.getByLabel('Confirmar nova senha').fill(newPassword);
    await np.getByRole('button', { name: 'Salvar nova senha' }).click();
    await expect(np).toHaveURL('/');
    const me = await apiOk(np, 'GET', '/auth/me');
    expect(me.permissions).toContain('order.create');
    await ctx.close();
  });
});
