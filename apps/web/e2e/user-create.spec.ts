import { expect, test } from '@playwright/test';
import { api, apiOk, login, password, submitLogin } from './helpers';

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
    await submitLogin(np, email, provisional, /\/login\/nova-senha/);
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

  /** Os papéis de fora da Matriz têm permissões que a Matriz não tem; a trava anti-escalada não pode barrá-los. */
  test('Matriz cria acesso para um grupo externo e a pessoa só enxerga o próprio grupo', async ({ page, browser }) => {
    const stamp = Date.now();
    await login(page, 'gestor@graoforte.demo');
    const orgs = (await apiOk(page, 'GET', '/organizations')) as { id: string; kind: string; name: string }[];
    const buyerOrg = orgs.find((o) => o.kind === 'BUYER')!;
    expect(buyerOrg, 'grupo de comprador no seed').toBeTruthy();

    const email = `comprador.externo.${stamp}@graoforte.demo`;
    await page.goto('/gestao/usuarios');
    await page.getByRole('button', { name: 'Criar usuário' }).click();
    const drawer = page.getByRole('dialog', { name: 'Criar usuário' });
    await drawer.getByLabel('Nome').fill('Comprador Externo');
    await drawer.getByLabel('E-mail').fill(email);
    const provisional = await drawer.getByRole('textbox', { name: /^Senha provisória/ }).inputValue();
    await drawer.getByLabel('Organização').selectOption(buyerOrg.id);
    // O papel do grupo aparece mesmo sem a Matriz ter as permissões dele (painel do comprador etc.).
    await drawer.getByRole('checkbox', { name: /^Comprador/ }).check();
    await drawer.getByRole('button', { name: 'Criar usuário' }).click();
    await expect(page.getByText('Usuário Comprador Externo criado')).toBeVisible();

    // A pessoa entra, troca a senha e recebe as permissões do grupo — não as da Matriz.
    const ctx = await browser.newContext();
    const np = await ctx.newPage();
    await submitLogin(np, email, provisional, /\/login\/nova-senha/);
    const newPassword = `Externo-${stamp}-xyz!`;
    await np.getByLabel('Senha provisória').fill(provisional);
    await np.getByLabel('Nova senha', { exact: true }).fill(newPassword);
    await np.getByLabel('Confirmar nova senha').fill(newPassword);
    await np.getByRole('button', { name: 'Salvar nova senha' }).click();
    await expect(np).toHaveURL('/');

    const me = await apiOk(np, 'GET', '/auth/me');
    expect(me.activeMembership.organization.id).toBe(buyerOrg.id);
    expect(me.permissions).toContain('dashboard.buyer');
    expect(me.permissions).not.toContain('order.create');

    // Só enxerga as ordens do próprio grupo (RLS), nunca as dos outros compradores.
    const daPessoa = await apiOk(np, 'GET', '/orders?pageSize=100');
    const daMatriz = await apiOk(page, 'GET', '/orders?pageSize=100');
    expect(daPessoa.total).toBeGreaterThan(0);
    expect(daPessoa.total).toBeLessThan(daMatriz.total);
    // Todas as ordens visíveis são de um único comprador: o do grupo da pessoa.
    const compradores = new Set((daPessoa.items as { buyer?: { name: string } }[]).map((o) => o.buyer?.name));
    expect(compradores.size).toBe(1);
    expect([...compradores][0]).toBeTruthy();
    await ctx.close();
  });
});
