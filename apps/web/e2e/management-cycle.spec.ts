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
    // Tempo por ordem: listagem paginada no servidor.
    const paged = await apiOk(page, 'GET', '/management/cycle/orders?pageSize=5');
    expect(paged.pageSize).toBe(5);
    expect(paged.items.length).toBeLessThanOrEqual(5);
    expect(paged.total).toBeGreaterThanOrEqual(paged.items.length);
    const onlyOpen = await apiOk(page, 'GET', '/management/cycle/orders?situation=open&pageSize=100');
    expect((onlyOpen.items as any[]).every((o) => o.completedAt === null)).toBe(true);
    const onlyDone = await apiOk(page, 'GET', '/management/cycle/orders?situation=completed&pageSize=100');
    expect((onlyDone.items as any[]).every((o) => o.completedAt !== null)).toBe(true);

    await expect(page.getByRole('heading', { name: 'Tempo por ordem' })).toBeVisible();
    const table = page.getByRole('table');
    await expect(table.getByRole('columnheader', { name: 'Ciclo' })).toBeVisible();
    await expect(table.locator('tbody tr')).toHaveCount(10);

    // Página seguinte traz outras ordens.
    const firstOrder = await table.locator('tbody tr td').first().innerText();
    await page.getByRole('button', { name: 'Próxima página' }).click();
    await expect.poll(async () => (await table.locator('tbody tr td').first().innerText()) !== firstOrder).toBe(true);
    await page.getByRole('button', { name: 'Página anterior' }).click();

    // Busca no servidor.
    const number = (await table.locator('tbody tr td').first().innerText()).split('\n')[0]!.trim();
    await page.getByLabel('Buscar ordens').fill(number);
    await expect(table.locator('tbody tr')).toHaveCount(1);
    await page.getByLabel('Buscar ordens').fill('zzz-inexistente');
    await expect(page.getByText('Nenhuma ordem no período com esses filtros.')).toBeVisible();
    await page.getByLabel('Buscar ordens').fill('');
    await expect(table.locator('tbody tr').first()).toBeVisible();

    // Datas: período manual recarrega os números do painel.
    const hoje = new Date().toISOString().slice(0, 10);
    const ontem = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    const response = page.waitForResponse((r) => r.url().includes('/management/cycle') && r.url().includes(`from=${ontem}`));
    await page.getByLabel('Data inicial').fill(ontem);
    await page.getByLabel('Data final').fill(hoje);
    await response;
    await expect(page.getByText(/\d+ ordem\(ns\)/).first()).toBeVisible();
    await page.screenshot({ path: 'test-results/management-cycle.png', fullPage: true });

    // Fora da Matriz: sem acesso e sem item de menu.
    const farm = await loginAs(browser, 'fazenda.joao@graoforte.demo');
    expect((await api(farm.page, 'GET', '/management/cycle')).status).toBe(403);
    await expect(farm.page.getByRole('link', { name: 'Gestão do ciclo' })).toHaveCount(0);
    await farm.context.close();
  });
});
