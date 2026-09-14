import { expect, test } from '@playwright/test';
import { api, apiOk, login, loginAs, password } from './helpers';

/** Locais (Q39): Matriz cadastra pela tela, o local aparece na busca do formulário da ordem e fica auditado. */
test.describe('Locais', () => {
  test.skip(!password, 'Defina E2E_PASSWORD com a senha demo');

  test('Matriz cadastra local e ele fica disponível como destino das ordens', async ({ page, browser }) => {
    const stamp = Date.now();
    const name = `Armazém E2E ${stamp}`;
    await login(page, 'admin@graoforte.demo');

    await page.goto('/cadastros/locais');
    await expect(page.getByRole('heading', { name: 'Locais' })).toBeVisible();
    // Com a lista vazia, o estado vazio repete o botão do cabeçalho.
    await page.getByRole('button', { name: 'Novo local' }).first().click();
    const drawer = page.getByRole('dialog', { name: 'Novo local' });
    await drawer.getByLabel(/^Nome do local/).fill(name);
    await drawer.getByLabel('Código').fill(`E2E${String(stamp).slice(-6)}`);
    await drawer.getByLabel('Tipo').selectOption('PORT');
    await drawer.getByLabel('Município').fill('Paranaguá');
    await drawer.getByLabel('UF').selectOption('PR');
    await drawer.getByLabel('CEP').fill('83203-000');
    await drawer.getByLabel('Endereço de entrega').fill('Av. Portuária, 100');
    await drawer.getByRole('button', { name: 'Salvar' }).click();
    await expect(page.getByText('Local cadastrado')).toBeVisible();
    await expect(page.getByRole('row', { name: new RegExp(name) })).toBeVisible();

    // Busca do formulário da ordem.
    const found = await apiOk<{ items: { id: string; label: string; meta: { city: string; state: string; address: string } }[] }>(
      page,
      'GET',
      `/lookups/locations?q=${encodeURIComponent(name)}&limit=10`,
    );
    expect(found.items).toHaveLength(1);
    expect(found.items[0]!.meta).toMatchObject({ city: 'Paranaguá', state: 'PR', address: 'Av. Portuária, 100' });

    // Código repetido é recusado; auditoria registrada.
    const duplicate = await api(page, 'POST', '/locations', { name: `${name} 2`, code: `E2E${String(stamp).slice(-6)}`, kind: 'WAREHOUSE', status: 'ACTIVE' });
    expect(duplicate.status).toBe(409);
    const audit = await apiOk<{ items: unknown[] }>(page, 'GET', `/audit?entityType=location&entityId=${found.items[0]!.id}`);
    expect(audit.items.length).toBeGreaterThan(0);

    // Fazenda não cadastra locais nem vê o item de menu.
    const farm = await loginAs(browser, 'fazenda.joao@graoforte.demo');
    expect((await api(farm.page, 'POST', '/locations', { name: `Fazenda ${stamp}`, kind: 'WAREHOUSE', status: 'ACTIVE' })).status).toBe(403);
    await expect(farm.page.getByRole('link', { name: 'Locais' })).toHaveCount(0);
    await farm.context.close();
  });
});
