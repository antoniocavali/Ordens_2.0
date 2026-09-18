import { expect, test } from '@playwright/test';
import { login, password } from './helpers';

/**
 * Fluxo crítico do vertical slice: login → tema persiste → Ctrl+K → Nova Ordem no drawer →
 * cascata Vendedor→Fazenda → rascunho → publicar → farol da Fazenda.
 * Requer ambiente com seed demo e E2E_PASSWORD.
 */

test.describe('Ordens de Carregamento', () => {
  test.skip(!password, 'Defina E2E_PASSWORD com a senha demo');

  test('Matriz cria, publica e a Fazenda visualiza', async ({ page, browser }) => {
    await login(page, 'admin@graoforte.demo');

    // Tema persiste após reload
    await page.getByRole('button', { name: 'Alterar tema' }).click();
    await page.getByRole('menuitem', { name: 'Escuro' }).click();
    // Aplica na hora, sem recarregar, e não volta ao tema anterior.
    await expect(page.locator('html')).toHaveClass(/dark/);
    await page.waitForTimeout(1000);
    await expect(page.locator('html')).toHaveClass(/dark/);
    await page.getByRole('button', { name: 'Alterar tema' }).click();
    await page.getByRole('menuitem', { name: 'Claro' }).click();
    await expect(page.locator('html')).not.toHaveClass(/dark/);
    await page.getByRole('button', { name: 'Alterar tema' }).click();
    await page.getByRole('menuitem', { name: 'Escuro' }).click();
    await expect(page.locator('html')).toHaveClass(/dark/);
    await page.reload();
    await expect(page.locator('html')).toHaveClass(/dark/);
    await expect(page.getByRole('button', { name: 'Alterar tema' })).toBeVisible();

    // Command palette
    await page.keyboard.press('Control+K');
    await expect(page.getByPlaceholder(/Buscar ordens/)).toBeVisible();
    await page.keyboard.press('Escape');

    await page.goto('/ordens?nova=1');
    const drawer = page.getByRole('dialog');
    await expect(drawer.getByText('Nova Ordem de Carregamento')).toBeVisible();

    // Fazenda desabilitada até escolher vendedor
    const farm = drawer.locator('#secao-origem-destino [role="combobox"]').first();
    await expect(farm).toBeDisabled();

    await drawer.locator('#secao-comercial [role="combobox"]').nth(1).click();
    await page.keyboard.type('João');
    await page.getByRole('option', { name: /João da Silva/ }).click();
    await drawer.locator('#secao-comercial [role="combobox"]').nth(2).click();
    await page.getByRole('option', { name: /Coop\. ABC/ }).click();
    await drawer.locator('#secao-comercial [role="combobox"]').nth(3).click();
    await page.getByRole('option', { name: /Milho/ }).click();

    await farm.click();
    const options = page.getByRole('listbox').getByRole('option');
    await expect(options).toHaveCount(3);
    await options.first().click();

    await drawer.locator('#secao-quantidades input').first().fill('400');
    await drawer.locator('#secao-logistica input[type="date"]').first().fill('2026-09-20');
    await drawer.locator('#secao-logistica input[type="date"]').nth(1).fill('2026-10-10');

    // Autosave gera o número
    await expect(drawer.getByText(/2026\/\d{5}/)).toBeVisible({ timeout: 10_000 });
    const number = (await drawer.getByText(/2026\/\d{5}/).first().textContent())!.trim();

    await drawer.getByRole('button', { name: 'Salvar e publicar' }).click();
    // Q39: destino é opcional, mas publicar sem ele pede confirmação.
    await page.getByRole('dialog', { name: 'Ordem sem destino' }).getByRole('button', { name: 'Publicar sem destino' }).click();
    await expect(page.getByText(`Ordem ${number} publicada`)).toBeVisible();

    // Fazenda abre o detalhe → farol verde para a Matriz
    const farmCtx = await browser.newContext();
    const farmPage = await farmCtx.newPage();
    await login(farmPage, 'fazenda.joao@graoforte.demo');
    await farmPage.goto('/ordens');
    const viewRegistered = farmPage.waitForResponse((r) => r.url().endsWith('/views') && r.request().method() === 'POST' && r.ok());
    await farmPage.getByRole('link', { name: number }).click();
    await expect(farmPage.getByRole('heading', { name: number })).toBeVisible();
    await viewRegistered;
    await farmCtx.close();

    await page.goto(`/ordens?q=${encodeURIComponent(number)}`);
    await expect(page.getByLabel(/Fazenda: Versão atual visualizada/).first()).toBeVisible({ timeout: 10_000 });
  });

  test('Fazenda não vê o botão Nova Ordem nem acessa a criação', async ({ page }) => {
    await login(page, 'fazenda.maria@graoforte.demo');
    await page.goto('/ordens');
    await expect(page.getByRole('button', { name: 'Nova Ordem' })).toHaveCount(0);
    const status = await page.evaluate(async () => {
      const csrf = document.cookie.match(/ordens_csrf=([^;]+)/)?.[1] ?? '';
      const r = await fetch('/api/orders', { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': csrf }, body: '{}' });
      return r.status;
    });
    expect(status).toBe(403);
  });
});
