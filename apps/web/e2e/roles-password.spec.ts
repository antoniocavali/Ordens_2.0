import { expect, test } from '@playwright/test';
import { api, apiOk, login, loginAs, password } from './helpers';

/**
 * Papéis personalizados (Q35), concessão individual (Q34) e senha provisória com troca obrigatória.
 */
test.describe('Papéis e senha provisória', () => {
  test.skip(!password, 'Defina E2E_PASSWORD com a senha demo');

  test('papel personalizado, senha provisória, troca obrigatória e concessão individual', async ({ page, browser }) => {
    const stamp = Date.now();
    await login(page, 'admin@graoforte.demo');
    const orgs = (await apiOk(page, 'GET', '/organizations')) as { id: string; kind: string }[];
    const matriz = orgs.find((o) => o.kind === 'MATRIZ')!;
    const farm = orgs.find((o) => o.kind === 'FARM')!;

    // Papel de Fazenda não recebe poderes da Matriz.
    const escalation = await api(page, 'POST', '/roles', { name: `Fazenda ampliada ${stamp}`, scope: 'FARM', permissions: ['order.create'] });
    expect(escalation.status).toBe(422);
    expect(farm).toBeTruthy();

    // ─── Criar papel pela tela ───
    const roleName = `Redefinição de senhas ${stamp}`;
    await page.goto('/gestao/papeis');
    await expect(page.getByRole('heading', { name: 'Papéis e permissões' })).toBeVisible();
    await page.getByRole('button', { name: 'Novo papel' }).click();
    const editor = page.getByRole('dialog', { name: 'Novo papel' });
    await editor.getByLabel('Nome').fill(roleName);
    await editor.getByRole('checkbox', { name: /^Visualizar usuários/ }).check();
    await editor.getByRole('checkbox', { name: /^Definir senha provisória de outros usuários/ }).check();
    await editor.getByRole('button', { name: 'Criar papel' }).click();
    await expect(page.getByText(`Papel ${roleName} criado`)).toBeVisible();
    const roles = (await apiOk(page, 'GET', '/roles')) as { id: string; name: string; system: boolean }[];
    const role = roles.find((r) => r.name === roleName)!;
    expect(role.system).toBe(false);

    // ─── Pessoas de teste ───
    const tEmail = `senha.t.${stamp}@graoforte.demo`;
    const uEmail = `senha.u.${stamp}@graoforte.demo`;
    const t = await apiOk(page, 'POST', '/users/invite', { name: 'Titular Senha', email: tEmail, organizationId: matriz.id, roles: ['MATRIZ_VIEWER'] });
    const u = await apiOk(page, 'POST', '/users/invite', { name: 'Outra Pessoa', email: uEmail, organizationId: matriz.id, roles: ['MATRIZ_VIEWER'] });

    // ─── Senha provisória pela tela ───
    const provisional = `Provisoria-${stamp}!`;
    await page.goto('/gestao/usuarios');
    await page.getByLabel('Buscar usuários').fill(tEmail);
    await page.getByRole('row', { name: new RegExp(tEmail.replace(/\./g, '\\.')) }).click();
    const drawer = page.getByRole('dialog', { name: 'Titular Senha' });
    await drawer.getByRole('button', { name: 'Definir senha provisória' }).click();
    await drawer.getByLabel('Senha provisória', { exact: true }).fill(provisional);
    await drawer.getByRole('button', { name: 'Confirmar senha provisória' }).click();
    await expect(page.getByText('Senha provisória definida')).toBeVisible();

    // Papel personalizado atribuído pela tela.
    await drawer.getByRole('checkbox', { name: new RegExp(`^${roleName}`) }).check();
    await drawer.getByRole('button', { name: 'Salvar papéis' }).click();
    await expect(page.getByText('Papéis atualizados')).toBeVisible();

    // ─── Login com senha provisória → troca obrigatória ───
    const ctx = await browser.newContext();
    const tp = await ctx.newPage();
    await tp.goto('/login');
    await tp.getByLabel('E-mail').fill(tEmail);
    await tp.getByLabel('Senha', { exact: true }).fill(provisional);
    await tp.getByRole('button', { name: 'Entrar' }).click();
    await expect(tp).toHaveURL(/\/login\/nova-senha/);
    // Enquanto não troca a senha, nada além disso é permitido.
    expect((await api(tp, 'GET', '/orders')).status).toBe(403);
    const newPassword = `NovaSenha-${stamp}!`;
    await tp.getByLabel('Senha provisória').fill(provisional);
    await tp.getByLabel('Nova senha', { exact: true }).fill(newPassword);
    await tp.getByLabel('Confirmar nova senha').fill(newPassword);
    await tp.getByRole('button', { name: 'Salvar nova senha' }).click();
    await expect(tp).toHaveURL('/');

    // Com o papel personalizado, redefine senha de outra pessoa, mas nunca de um administrador.
    const meAdmin = await apiOk(page, 'GET', '/auth/me');
    expect((await api(tp, 'POST', `/users/memberships/${u.membershipId}/password`, { temporaryPassword: `Outra-${stamp}-abc!` })).status).toBe(204);
    expect((await api(tp, 'POST', `/users/memberships/${meAdmin.activeMembership.id}/password`, { temporaryPassword: `Admin-${stamp}-abc!` })).status).toBe(403);

    // Papel atribuído não pode ser arquivado.
    expect((await api(page, 'POST', `/roles/${role.id}/archive`)).status).toBe(422);

    // ─── Concessão individual no lugar do papel ───
    await apiOk(page, 'PATCH', `/users/memberships/${t.membershipId}`, { roles: ['MATRIZ_VIEWER'], customRoleIds: [] });
    expect((await api(tp, 'POST', `/users/memberships/${u.membershipId}/password`, { temporaryPassword: `Outra2-${stamp}-abc!` })).status).toBe(403);
    await apiOk(page, 'PUT', `/users/memberships/${t.membershipId}/grants`, { permissions: ['user.password.manage'] });
    expect((await api(tp, 'POST', `/users/memberships/${u.membershipId}/password`, { temporaryPassword: `Outra3-${stamp}-abc!` })).status).toBe(204);
    await apiOk(page, 'PUT', `/users/memberships/${t.membershipId}/grants`, { permissions: [] });
    expect((await api(tp, 'POST', `/users/memberships/${u.membershipId}/password`, { temporaryPassword: `Outra4-${stamp}-abc!` })).status).toBe(403);
    await ctx.close();

    // Sem atribuições, o papel pode ser arquivado.
    expect((await api(page, 'POST', `/roles/${role.id}/archive`)).status).toBe(200);

    // Quem não administra não cria papéis.
    const manager = await loginAs(browser, 'gestor@graoforte.demo');
    expect((await api(manager.page, 'POST', '/roles', { name: `Sem permissão ${stamp}`, scope: 'MATRIZ', permissions: ['order.read'] })).status).toBe(403);
    await manager.context.close();
  });
});
