import { expect, test } from '@playwright/test';
import { api, apiOk, login, loginAs, password } from './helpers';

/** Trilha de auditoria: evento gerado aparece com rótulo, filtro por área e detalhe; acesso restrito. */
test.describe('Auditoria', () => {
  test.skip(!password, 'Defina E2E_PASSWORD com a senha demo');

  test('Administrador encontra o evento pela área e vê o que foi registrado', async ({ page, browser }) => {
    await login(page, 'admin@graoforte.demo');
    const roleName = `Auditoria E2E ${Date.now()}`;
    const role = await apiOk(page, 'POST', '/roles', { name: roleName, scope: 'MATRIZ', permissions: ['order.read'] });

    await page.goto('/gestao/auditoria');
    await expect(page.getByRole('heading', { name: 'Auditoria' })).toBeVisible();
    await page.getByLabel('Área').selectOption('roles');
    await expect(page).toHaveURL(/area=roles/);

    const row = page.getByRole('row', { name: new RegExp(roleName) }).first();
    await expect(row).toBeVisible();
    await expect(row.getByText('Papel criado')).toBeVisible();
    await expect(row.getByText('Carla Mendes')).toBeVisible();
    await row.click();
    await expect(page.getByText('order.read').first()).toBeVisible();
    await expect(page.getByText('role.created').first()).toBeVisible();

    // Filtro por entidade específica via URL (link de outras telas).
    await page.goto(`/gestao/auditoria?entidade=role&id=${role.id}`);
    await expect(page.getByText('Papel específica')).toBeVisible();
    await expect(page.getByRole('row', { name: new RegExp(roleName) })).toHaveCount(1);

    // Sem audit.read: 403 e sem item no menu.
    const operator = await loginAs(browser, 'operador@graoforte.demo');
    expect((await api(operator.page, 'GET', '/audit')).status).toBe(403);
    await expect(operator.page.getByRole('link', { name: 'Auditoria' })).toHaveCount(0);
    await operator.context.close();
  });
});
