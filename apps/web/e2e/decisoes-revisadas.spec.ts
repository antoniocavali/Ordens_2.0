import { expect, test } from '@playwright/test';
import { api, apiOk, login, loginAs, password } from './helpers';

const addDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

/** Ajustes pedidos na revisão das decisões provisórias (18/09/2026). */
test.describe('Decisões revisadas', () => {
  test.skip(!password, 'Defina E2E_PASSWORD com a senha demo');

  test('Q38 — exportar relatórios é permissão por grupo e respeita o que o perfil vê', async ({ page, browser }) => {
    await login(page, 'admin@graoforte.demo');
    const stamp = Date.now();
    // Grupo de Comprador com permissão de exportar.
    const role = await apiOk(page, 'POST', '/roles', { name: `Compras — relatórios ${stamp}`, scope: 'BUYER', permissions: ['order.read', 'report.export'] });
    const users = (await apiOk(page, 'GET', '/users?q=comprador.abc&pageSize=10')).items as any[];
    const buyer = users.find((u) => u.email === 'comprador.abc@graoforte.demo');
    const original = { roles: buyer.roles, customRoleIds: buyer.customRoles.map((c: any) => c.id) };
    await apiOk(page, 'PATCH', `/users/memberships/${buyer.membershipId}`, { ...original, customRoleIds: [...original.customRoleIds, role.id] });

    try {
      const b = await loginAs(browser, 'comprador.abc@graoforte.demo');
      const report = await apiOk(b.page, 'GET', '/reports/orders');
      const keys = (report.columns as any[]).map((c) => c.key);
      expect(keys).toContain('quantity');
      // Comprador não vê preço (mesma regra da tela da ordem).
      expect(keys).not.toContain('unit_price');
      expect(keys).not.toContain('total_value');
      // Relatório exclusivo da Matriz continua fechado.
      expect((await api(b.page, 'GET', '/reports/carriers')).status).toBe(403);
      await b.page.goto('/gestao/relatorios');
      await expect(b.page.getByRole('radio', { name: /Solicitações do Comprador/ })).toBeVisible();
      await expect(b.page.getByRole('radio', { name: /Desempenho de transportadoras/ })).toHaveCount(0);
      await b.context.close();
    } finally {
      await apiOk(page, 'PATCH', `/users/memberships/${buyer.membershipId}`, original);
    }
  });

  test('Q39 — enviar solicitação sem destino pede confirmação', async ({ page }) => {
    await login(page, 'comprador.abc@graoforte.demo');
    const commodity = ((await apiOk(page, 'GET', '/lookups/commodities')).items as any[])[0];
    const unit = ((await apiOk(page, 'GET', '/lookups/units')) as any[]).find((u) => u.label === 't');
    const draft = await apiOk(page, 'POST', '/orders/buyer', { commodityId: commodity.id, unitId: unit.id, quantity: '25', loadingStartsOn: addDays(2), loadingEndsOn: addDays(15) });

    await page.goto(`/ordens/${draft.id}`);
    await page.getByRole('button', { name: 'Enviar ao Faturamento' }).click();
    const dialog = page.getByRole('dialog', { name: 'Ordem sem destino' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Continuar editando' }).click();
    expect((await apiOk(page, 'GET', `/orders/${draft.id}`)).status).toBe('DRAFT');

    await page.getByRole('button', { name: 'Enviar ao Faturamento' }).click();
    await page.getByRole('dialog', { name: 'Ordem sem destino' }).getByRole('button', { name: 'Continuar sem destino' }).click();
    await expect.poll(async () => (await apiOk(page, 'GET', `/orders/${draft.id}`)).status).toBe('PENDING_BILLING');
  });

  test('Q40 — Faturamento lança e publica ordens da Matriz', async ({ page }) => {
    await login(page, 'faturamento@graoforte.demo');
    const sellers = (await apiOk(page, 'GET', '/lookups/partners?role=SELLER&limit=20')).items as any[];
    const seller = sellers.find((s) => /jo[aã]o/i.test(s.label)) ?? sellers[0];
    const farm = ((await apiOk(page, 'GET', `/lookups/farms?sellerId=${seller.id}&limit=5`)).items as any[])[0];
    const buyer = ((await apiOk(page, 'GET', '/lookups/partners?role=BUYER&limit=20')).items as any[])[0];
    const commodity = ((await apiOk(page, 'GET', '/lookups/commodities')).items as any[])[0];
    const unit = ((await apiOk(page, 'GET', '/lookups/units')) as any[]).find((u) => u.label === 't');
    const draft = await apiOk(page, 'POST', '/orders', {
      sellerPartnerId: seller.id, farmId: farm.id, buyerPartnerId: buyer.id, commodityId: commodity.id, unitId: unit.id,
      quantity: '80', loadingStartsOn: addDays(1), loadingEndsOn: addDays(20), destinationName: 'Armazém Central',
    });
    const published = await apiOk(page, 'POST', `/orders/${draft.id}/publish`, { expectedUpdatedAt: draft.updatedAt });
    expect(published.status).toBe('PUBLISHED');
  });

  test('Q46 — ciclo agrupado por commodity, fazenda ou comprador', async ({ page }) => {
    await login(page, 'admin@graoforte.demo');
    const cycle = await apiOk(page, 'GET', '/management/cycle?from=2026-01-01&to=2026-12-31');
    expect(Object.keys(cycle.groups).sort()).toEqual(['buyer', 'commodity', 'farm']);

    await page.goto('/gestao/ciclo');
    const group = page.getByRole('radiogroup', { name: 'Agrupar por' });
    await expect(page.getByRole('heading', { name: 'Ciclo por commodity' })).toBeVisible();
    await group.getByRole('radio', { name: 'Fazenda' }).click();
    await expect(page.getByRole('heading', { name: 'Ciclo por fazenda' })).toBeVisible();
    await group.getByRole('radio', { name: 'Comprador' }).click();
    await expect(page.getByRole('heading', { name: 'Ciclo por comprador' })).toBeVisible();
  });

  test('Q47 — faturar sem a nota da Matriz exige confirmação e fica auditado', async ({ page }) => {
    await login(page, 'admin@graoforte.demo');
    const loads = (await apiOk(page, 'GET', '/loads?status=AWAITING_MATRIZ_INVOICE&pageSize=50')).items as any[];
    const load = loads.find((l) => l.matrizChecklist && !l.matrizChecklist.ready);
    test.skip(!load, 'nenhuma carga aguardando faturamento sem a nota da Matriz');

    // Sem confirmação: recusado com código próprio.
    const refused = await api(page, 'POST', `/loads/${load.id}/transition`, { to: 'MATRIZ_INVOICED', expectedUpdatedAt: load.updatedAt });
    expect(refused.status).toBe(422);
    expect(refused.json.error.code).toBe('MATRIZ_INVOICE_MISSING');

    // Pela tela: o botão abre a confirmação e segue sem os documentos.
    await page.goto(`/cargas?abrir=${load.id}`);
    const drawer = page.getByRole('dialog').first();
    await drawer.getByRole('button', { name: 'Registrar faturamento da Matriz' }).click();
    const confirm = page.getByRole('dialog', { name: 'Seguir sem a nota da Matriz?' });
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: 'Faturar sem a nota' }).click();
    await expect.poll(async () => (await apiOk(page, 'GET', `/loads/${load.id}`)).status).toBe('MATRIZ_INVOICED');

    const audit = await apiOk(page, 'GET', '/audit?action=load.matriz_invoice_waived&pageSize=5');
    expect((audit.items as any[]).some((e) => e.entityId === load.id)).toBe(true);
  });
});
