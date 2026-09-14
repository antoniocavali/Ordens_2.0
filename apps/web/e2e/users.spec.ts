import { expect, test } from '@playwright/test';
import { api, apiOk, login, password } from './helpers';

/**
 * Gestão de usuários: convite → convite pendente → papéis → reenvio → desativação.
 * Proteções: último Administrador ativo e escopo da Fazenda.
 */
test.describe('Usuários', () => {
  test.skip(!password, 'Defina E2E_PASSWORD com a senha demo');

  test('Administrador convida, ajusta papéis, reenvia convite e desativa o acesso', async ({ page }) => {
    await login(page, 'admin@graoforte.demo');
    await page.goto('/gestao/usuarios');
    await expect(page.getByRole('heading', { name: 'Usuários' })).toBeVisible();

    const orgs = (await apiOk(page, 'GET', '/organizations')) as { id: string; kind: string }[];
    const matriz = orgs.find((o) => o.kind === 'MATRIZ')!;
    const email = `e2e.${Date.now()}@graoforte.demo`;

    await page.getByRole('button', { name: 'Convidar usuário' }).click();
    const invite = page.getByRole('dialog', { name: 'Convidar usuário' });
    await invite.getByRole('button', { name: 'Enviar convite' }).click();
    await expect(invite.getByText('Selecione ao menos um papel')).toBeVisible();

    await invite.getByLabel('Nome').fill('Pessoa E2E');
    await invite.getByLabel('E-mail').fill(email);
    await invite.getByLabel('Organização').selectOption(matriz.id);
    await invite.getByRole('checkbox', { name: /^Atendente/ }).check();
    await invite.getByRole('button', { name: 'Enviar convite' }).click();
    await expect(page.getByText(`Convite enviado para ${email}`)).toBeVisible();

    await page.getByLabel('Buscar usuários').fill(email);
    const row = page.getByRole('row', { name: new RegExp(email.replace(/\./g, '\\.')) });
    await expect(row.getByText('Convite pendente')).toBeVisible();
    await row.click();

    const drawer = page.getByRole('dialog', { name: 'Pessoa E2E' });
    await drawer.getByRole('checkbox', { name: /^Operador Matriz/ }).check();
    await drawer.getByRole('checkbox', { name: /^Atendente/ }).uncheck();
    await drawer.getByRole('button', { name: 'Salvar papéis' }).click();
    await expect(page.getByText('Papéis atualizados')).toBeVisible();
    await expect(drawer.getByRole('checkbox', { name: /^Operador Matriz/ })).toBeChecked();

    await drawer.getByRole('button', { name: 'Reenviar convite' }).click();
    await expect(page.getByText(`Convite reenviado para ${email}`)).toBeVisible();

    await drawer.getByRole('button', { name: 'Desativar acesso' }).click();
    await expect(page.getByText('Acesso desativado')).toBeVisible();
    // Drawer fecha: a lista volta a ser acessível e reflete papéis e status gravados.
    await expect(drawer).toHaveCount(0);
    await expect(row.getByText('Operador Matriz')).toBeVisible();
    await expect(row.getByText('Inativo')).toBeVisible();

    // A Matriz não fica sem Administrador ativo; ninguém desativa o próprio acesso.
    const me = await apiOk(page, 'GET', '/auth/me');
    const demote = await api(page, 'PATCH', `/users/memberships/${me.activeMembership.id}`, { roles: ['MATRIZ_MANAGER'] });
    expect(demote.status).toBe(422);
    expect(demote.json.error.message).toMatch(/ao menos um Administrador/);
    expect((await api(page, 'PATCH', `/users/memberships/${me.activeMembership.id}`, { status: 'INACTIVE' })).status).toBe(422);
  });

  test('Administrador da Fazenda só gerencia a própria organização', async ({ page }) => {
    await login(page, 'fazenda.joao@graoforte.demo');
    const list = await apiOk(page, 'GET', '/users?pageSize=200');
    const orgIds = new Set((list.items as { organization: { id: string } }[]).map((u) => u.organization.id));
    expect(orgIds.size).toBe(1);
    const [ownOrg] = [...orgIds];

    // Papel de outro tipo de organização é recusado; convite na própria fazenda funciona.
    const wrongRole = await api(page, 'POST', '/users/invite', { name: 'Fora do Escopo', email: `fora.${Date.now()}@teste.local`, organizationId: ownOrg, roles: ['MATRIZ_ADMIN'] });
    expect(wrongRole.status).toBe(422);
    const ok = await api(page, 'POST', '/users/invite', { name: 'Operador Fazenda E2E', email: `faz.${Date.now()}@teste.local`, organizationId: ownOrg, roles: ['FARM_OPERATOR'] });
    expect(ok.status).toBeLessThan(300);

    await page.goto('/gestao/usuarios');
    await expect(page.getByRole('button', { name: 'Convidar usuário' })).toBeVisible();
    const buyer = await api(page, 'GET', '/users?pageSize=200');
    expect(buyer.status).toBe(200);
  });
});
