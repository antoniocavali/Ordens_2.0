import { expect, test, type Page } from '@playwright/test';
import { api, apiOk, login, loginAs, password } from './helpers';

const addDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

/** Matriz suspende, retoma e cancela ordens com motivo; cancelamento bloqueado com carga ativa. */
test.describe('Suspensão e cancelamento de ordens', () => {
  test.skip(!password, 'Defina E2E_PASSWORD com a senha demo');

  async function publishedOrder(page: Page) {
    const sellers = (await apiOk(page, 'GET', '/lookups/partners?role=SELLER&limit=20')).items as any[];
    const seller = sellers.find((s) => /jo[aã]o/i.test(s.label)) ?? sellers.find((s) => Number(s.meta?.farms ?? 0) > 0);
    const farm = ((await apiOk(page, 'GET', `/lookups/farms?sellerId=${seller.id}&limit=5`)).items as any[])[0];
    const buyers = (await apiOk(page, 'GET', '/lookups/partners?role=BUYER&limit=20')).items as any[];
    const buyer = buyers.find((b) => /abc/i.test(b.label)) ?? buyers[0];
    const commodity = ((await apiOk(page, 'GET', '/lookups/commodities')).items as any[])[0];
    const unit = ((await apiOk(page, 'GET', '/lookups/units')) as any[]).find((u) => u.label === 't');
    const draft = await apiOk(page, 'POST', '/orders', {
      sellerPartnerId: seller.id,
      farmId: farm.id,
      buyerPartnerId: buyer.id,
      commodityId: commodity.id,
      unitId: unit.id,
      quantity: '100',
      loadingStartsOn: addDays(1),
      loadingEndsOn: addDays(30),
    });
    const published = await apiOk(page, 'POST', `/orders/${draft.id}/publish`, { expectedUpdatedAt: draft.updatedAt });
    return apiOk(page, 'POST', `/orders/${draft.id}/releases`, { quantity: '60', expectedVersion: published.version });
  }

  test('Matriz suspende, retoma e cancela; cancelamento exige cargas encerradas', async ({ page, browser }) => {
    await login(page, 'admin@graoforte.demo');
    let order = await publishedOrder(page);
    expect(order.allowedActions).toEqual(expect.arrayContaining(['suspend', 'cancel']));

    // ─── Suspensão pela tela (motivo obrigatório) ───
    await page.goto(`/ordens/${order.id}`);
    await page.getByRole('button', { name: 'Suspender' }).click();
    const dialog = page.getByRole('dialog', { name: 'Suspender ordem' });
    await expect(dialog.getByRole('button', { name: 'Suspender ordem' })).toBeDisabled();
    await dialog.getByLabel(/Motivo/).fill('Aguardando confirmação de qualidade do lote');
    await dialog.getByRole('button', { name: 'Suspender ordem' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Ordem suspensa' })).toContainText('Aguardando confirmação de qualidade');
    order = await apiOk(page, 'GET', `/orders/${order.id}`);
    expect(order).toMatchObject({ status: 'SUSPENDED', suspendReason: 'Aguardando confirmação de qualidade do lote' });

    // Suspensa: sem liberações nem agendamentos novos.
    expect((await api(page, 'POST', `/orders/${order.id}/releases`, { quantity: '5', expectedVersion: order.version })).status).toBe(422);
    expect((await api(page, 'POST', '/appointments', { orderId: order.id, scheduledOn: addDays(2), expectedQty: '5' })).status).toBe(422);

    // Fazenda e Comprador são avisados e veem o motivo.
    const farm = await loginAs(browser, 'fazenda.joao@graoforte.demo');
    await expect
      .poll(async () => ((await apiOk(farm.page, 'GET', '/notifications')).items as any[]).some((n) => n.title.includes(`${order.number} suspensa`)), { timeout: 30_000 })
      .toBe(true);
    expect((await apiOk(farm.page, 'GET', `/orders/${order.id}`)).suspendReason).toBe('Aguardando confirmação de qualidade do lote');
    // Fazenda não suspende nem cancela.
    expect((await api(farm.page, 'POST', `/orders/${order.id}/resume`, { expectedUpdatedAt: order.updatedAt })).status).toBe(403);

    // ─── Retomada ───
    await page.getByRole('button', { name: 'Retomar ordem' }).click();
    await expect.poll(async () => (await apiOk(page, 'GET', `/orders/${order.id}`)).status).toBe('PUBLISHED');

    // ─── Carga ativa bloqueia o cancelamento ───
    const transport = { carrierName: 'Trans Agro Logística', driverName: 'Antônio Pereira', driverCpf: '39053344705', vehicles: [{ plate: 'RVG1A23', type: 'TRUCK_TRACTOR' }] };
    const withLoad = await apiOk(page, 'POST', '/appointments', { orderId: order.id, scheduledOn: addDays(2), expectedQty: '10', ...transport });
    for (const to of ['CONFIRMED', 'CHECKED_IN']) await apiOk(page, 'POST', `/appointments/${withLoad.id}/transition`, { to });
    const converted = await apiOk(page, 'POST', `/appointments/${withLoad.id}/transition`, { to: 'CONVERTED' });
    const pendingAppointment = await apiOk(page, 'POST', '/appointments', { orderId: order.id, scheduledOn: addDays(3), expectedQty: '10', ...transport });

    order = await apiOk(page, 'GET', `/orders/${order.id}`);
    const blocked = await api(page, 'POST', `/orders/${order.id}/cancel`, { expectedUpdatedAt: order.updatedAt, reason: 'Contrato rescindido' });
    expect(blocked.status).toBe(422);
    expect(blocked.json.error.message).toContain('carga(s) em andamento');

    const load = await apiOk(page, 'GET', `/loads/${converted.loadId}`);
    await apiOk(page, 'POST', `/loads/${load.id}/transition`, { to: 'CANCELLED', expectedUpdatedAt: load.updatedAt, notes: 'Veículo dispensado' });

    // ─── Cancelamento pela tela ───
    await page.reload();
    await page.getByRole('button', { name: 'Cancelar ordem' }).click();
    const cancelDialog = page.getByRole('dialog', { name: 'Cancelar ordem' });
    await cancelDialog.getByLabel(/Motivo/).fill('Contrato rescindido pelo comprador');
    await cancelDialog.getByRole('button', { name: 'Cancelar ordem' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Ordem cancelada' })).toContainText('Contrato rescindido pelo comprador');

    const cancelled = await apiOk(page, 'GET', `/orders/${order.id}`);
    expect(cancelled.status).toBe('CANCELLED');
    expect(cancelled.quantities.cancelled).toBe('100');
    expect(cancelled.releases.every((r: any) => r.status === 'CANCELLED')).toBe(true);
    expect((await apiOk(page, 'GET', `/appointments?orderId=${order.id}&pageSize=50`)).items.find((a: any) => a.id === pendingAppointment.id).status).toBe('CANCELLED');
    expect((await api(page, 'POST', `/orders/${order.id}/cancel`, { expectedUpdatedAt: cancelled.updatedAt, reason: 'De novo' })).status).toBe(422);

    const timeline = ((await apiOk(farm.page, 'GET', `/orders/${order.id}/timeline`)) as any[]).map((e) => e.action);
    expect(timeline).toEqual(expect.arrayContaining(['order.suspended', 'order.resumed', 'order.cancelled']));
    const audit = ((await apiOk(page, 'GET', `/audit?entityType=loading_order&entityId=${order.id}&pageSize=100`)).items as any[]).map((e) => e.action);
    expect(audit).toEqual(expect.arrayContaining(['order.suspended', 'order.resumed', 'order.cancelled']));
    await farm.context.close();
  });
});
