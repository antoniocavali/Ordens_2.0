import { expect, test } from '@playwright/test';
import { login, password } from './helpers';

/** Grade da Central de Ordens: ordenação no servidor, seleção, colunas e redimensionamento (react-table v9). */
test.describe('Grade de ordens', () => {
  test.skip(!password, 'Defina E2E_PASSWORD com a senha demo');

  test('ordena, seleciona, oculta colunas e redimensiona', async ({ page }) => {
    await page.setViewportSize({ width: 1500, height: 900 });
    await login(page, 'admin@graoforte.demo');
    await page.goto('/ordens');
    const grid = page.getByRole('table');
    await expect(grid.locator('tbody tr').first()).toBeVisible();

    // Ordenação é do servidor: o clique vai para a URL e a API recebe o novo sort.
    const sorted = page.waitForResponse((r) => r.url().includes('/api/orders?') && /sort=number%3A(asc|desc)/.test(r.url()));
    await grid.getByRole('columnheader', { name: /OC/ }).getByRole('button').click();
    await sorted;
    await expect(page).toHaveURL(/sort=number/);

    // Seleção: uma linha e depois todas da página.
    const rows = grid.locator('tbody tr');
    await rows.first().getByRole('checkbox').check();
    await expect(rows.first()).toHaveAttribute('aria-selected', 'true');
    await grid.getByRole('checkbox', { name: 'Selecionar todas' }).check();
    const count = await rows.count();
    await expect(grid.locator('tbody tr[aria-selected="true"]')).toHaveCount(count);
    await grid.getByRole('checkbox', { name: 'Selecionar todas' }).uncheck();
    await expect(grid.locator('tbody tr[aria-selected="true"]')).toHaveCount(0);

    // Colunas: mostrar (Contrato vem oculta por padrão) e ocultar de novo pelo menu.
    await page.getByRole('button', { name: 'Escolher colunas' }).click();
    await page.getByRole('menuitemcheckbox', { name: /Contrato/ }).click();
    await page.keyboard.press('Escape');
    await expect(grid.getByRole('columnheader', { name: 'Contrato', exact: true })).toHaveCount(1);
    await page.getByRole('button', { name: 'Escolher colunas' }).click();
    await page.getByRole('menuitemcheckbox', { name: /Contrato/ }).click();
    await page.keyboard.press('Escape');
    await expect(grid.getByRole('columnheader', { name: 'Contrato', exact: true })).toHaveCount(0);

    // Redimensionar: arrastar a borda do cabeçalho muda a largura da coluna.
    const header = grid.getByRole('columnheader', { name: 'Commodity', exact: true });
    const before = (await header.boundingBox())!.width;
    await header.hover();
    const handle = header.locator('span[aria-hidden]').last();
    const box = (await handle.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + 80, box.y + box.height / 2, { steps: 5 });
    await page.mouse.up();
    await expect.poll(async () => (await header.boundingBox())!.width).toBeGreaterThan(before + 40);
  });
});
