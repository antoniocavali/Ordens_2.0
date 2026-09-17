import { expect, test } from '@playwright/test';
import { api, apiOk, login, loginAs, password } from './helpers';

/** Recebimento no destino opcional por ordem: dispensado, a carga vai do trânsito direto ao faturamento da Matriz. */
test.describe('Recebimento no destino opcional', () => {
  test.skip(!password, 'Defina E2E_PASSWORD com a senha demo');

  test('Matriz dispensa o recebimento e encerra o transporte sem chegada nem conferência', async ({ page, browser }) => {
    await login(page, 'admin@graoforte.demo');
    const loads = (await apiOk(page, 'GET', '/loads?status=IN_TRANSIT&pageSize=50')).items as any[];
    expect(loads.length).toBeGreaterThan(0);
    const load = loads[0];
    expect(load.order.requiresReceipt).toBe(true);
    expect(load.allowedTransitions).toContain('ARRIVED');
    expect(load.allowedTransitions).not.toContain('AWAITING_MATRIZ_INVOICE');

    // Recebimento exigido: pular a etapa é recusado.
    const skip = await api(page, 'POST', `/loads/${load.id}/transition`, { to: 'AWAITING_MATRIZ_INVOICE', expectedUpdatedAt: load.updatedAt });
    expect(skip.status).toBe(422);
    expect(JSON.stringify(skip.json)).toContain('exige o recebimento');

    // Fazenda não altera a exigência.
    let order = await apiOk(page, 'GET', `/orders/${load.order.id}`);
    const farm = await loginAs(browser, 'fazenda.joao@graoforte.demo');
    const farmTry = await api(farm.page, 'PATCH', `/orders/${order.id}`, { expectedVersion: order.version, expectedUpdatedAt: order.updatedAt, data: { requiresReceipt: false } });
    expect([403, 404]).toContain(farmTry.status);
    await farm.context.close();

    // Matriz dispensa pelo formulário da ordem (gera nova versão).
    await page.goto(`/ordens/${order.id}`);
    await expect(page.getByText('Recebimento no destino')).toBeVisible();
    order = await apiOk(page, 'PATCH', `/orders/${order.id}`, { expectedVersion: order.version, expectedUpdatedAt: order.updatedAt, data: { requiresReceipt: false } });
    expect(order.requiresReceipt).toBe(false);
    await page.reload();
    await expect(page.getByText('Dispensado')).toBeVisible();

    // Painel da carga: sem campo de quantidade recebida; ação "Encerrar transporte".
    await page.goto(`/cargas?abrir=${load.id}`);
    const drawer = page.getByRole('dialog');
    await expect(drawer.getByText('Esta ordem dispensa o recebimento no destino.')).toBeVisible();
    await expect(drawer.getByLabel(/Quantidade recebida/)).toHaveCount(0);
    await expect(drawer.getByRole('button', { name: 'Registrar chegada' })).toHaveCount(0);
    await drawer.getByRole('button', { name: 'Encerrar transporte' }).click();
    await expect.poll(async () => (await apiOk(page, 'GET', `/loads/${load.id}`)).status).toBe('AWAITING_MATRIZ_INVOICE');

    const audit = await apiOk(page, 'GET', `/audit?action=load.receipt_skipped&pageSize=5`);
    expect((audit.items as any[]).some((e) => e.entityId === load.id)).toBe(true);
  });
});
