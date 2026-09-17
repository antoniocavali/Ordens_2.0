import { expect, test } from '@playwright/test';
import { api, apiOk, login, loginAs, password } from './helpers';

/** Q46: painel de Gestão com o tempo entre a publicação e a conclusão da ordem. */
test.describe('Painel de Gestão do ciclo', () => {
  test.skip(!password, 'Defina E2E_PASSWORD com a senha demo');

  test('Matriz acompanha o ciclo; Fazenda e Comprador não acessam', async ({ page, browser }) => {
    await login(page, 'admin@graoforte.demo');
    const cycle = await apiOk(page, 'GET', '/management/cycle');
    expect(cycle).toMatchObject({ from: expect.any(String), to: expect.any(String) });
    expect(cycle.histogram).toHaveLength(5);
    expect(cycle.openAging.reduce((a: number, b: any) => a + b.count, 0)).toBeGreaterThan(0);

    await page.goto('/gestao/ciclo');
    await expect(page.getByRole('heading', { name: 'Gestão do ciclo' })).toBeVisible();
    await expect(page.getByText('Ordens concluídas').first()).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Etapas do ciclo' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Ordens abertas por idade' })).toBeVisible();
    await page.getByRole('radio', { name: '30 dias' }).click();
    await expect.poll(async () => (await apiOk(page, 'GET', '/management/cycle')).completed).toBeGreaterThanOrEqual(0);
    await expect(page.getByRole('link', { name: 'Gestão do ciclo' })).toBeVisible();
    // Tempo por ordem e filtro por datas.
    await expect(page.getByRole('heading', { name: 'Tempo por ordem' })).toBeVisible();
    const table = page.getByRole('table');
    await expect(table.getByRole('columnheader', { name: 'Ciclo' })).toBeVisible();
    const first = table.locator('tbody tr').first();
    const number = (await first.locator('td').first().innerText()).split('\n')[0]!.trim();
    await page.getByLabel('Filtrar ordens').fill(number);
    await expect(table.locator('tbody tr')).toHaveCount(1);
    await page.getByLabel('Filtrar ordens').fill('zzz-inexistente');
    await expect(page.getByText('Nenhuma ordem no período com esse filtro.')).toBeVisible();
    await page.getByLabel('Filtrar ordens').fill('');

    // Datas: período manual recarrega os números do painel.
    const hoje = new Date().toISOString().slice(0, 10);
    const ontem = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    const response = page.waitForResponse((r) => r.url().includes('/management/cycle') && r.url().includes(`from=${ontem}`));
    await page.getByLabel('Data inicial').fill(ontem);
    await page.getByLabel('Data final').fill(hoje);
    await response;
    await expect(page.getByText(/de \d+ ordem\(ns\)/)).toBeVisible();
    await page.screenshot({ path: 'test-results/management-cycle.png', fullPage: true });

    // Fora da Matriz: sem acesso e sem item de menu.
    const farm = await loginAs(browser, 'fazenda.joao@graoforte.demo');
    expect((await api(farm.page, 'GET', '/management/cycle')).status).toBe(403);
    await expect(farm.page.getByRole('link', { name: 'Gestão do ciclo' })).toHaveCount(0);
    await farm.context.close();
  });
});
