import { expect, test } from '@playwright/test';
import { login, password, prepareLoad } from './helpers';

/**
 * A tela da carga é recarregada sozinha — depois de avançar a etapa, por aviso em tempo real, ao
 * processar um anexo. Essa recarga não pode apagar o que a pessoa está digitando: num servidor
 * ocupado ela chega depois de o peso já ter sido informado.
 */
test.describe('Pesagem da carga', () => {
  test.skip(!password, 'Defina E2E_PASSWORD com a senha demo');

  test('pesos digitados antes de a recarga chegar não somem', async ({ page }) => {
    await login(page, 'admin@graoforte.demo');
    const setup = await prepareLoad(page);
    await page.goto(`/cargas?abrir=${setup.loadId}`);
    const drawer = page.getByRole('dialog');
    await expect(drawer.getByRole('button', { name: 'Iniciar carregamento', exact: true })).toBeVisible({ timeout: 20_000 });

    // Recarga da carga lenta: a digitação acontece antes de ela chegar.
    await page.route(new RegExp(`/api/loads/${setup.loadId}$`), async (route) => {
      if (route.request().method() === 'GET') await new Promise((r) => setTimeout(r, 2000));
      return route.continue();
    });
    const advance = async (label: string) => {
      const response = page.waitForResponse((r) => r.url().includes(`/loads/${setup.loadId}/transition`) && r.request().method() === 'POST');
      await drawer.getByRole('button', { name: label, exact: true }).click();
      return response;
    };

    expect((await advance('Iniciar carregamento')).ok()).toBe(true);
    await drawer.getByLabel('Peso bruto (kg)').fill('48500');
    await drawer.getByLabel('Tara (kg)').fill('38500');

    const confirmed = await advance('Confirmar carregamento');
    expect(confirmed.ok(), await confirmed.text()).toBe(true);
    await expect(drawer.getByLabel('Peso bruto (kg)')).toHaveValue(/48\.?500/);
  });
});
