import { expect, test, type Page } from '@playwright/test';
import { api, apiOk, login, loginAs, password } from './helpers';

const addDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

const TRANSPORT = {
  carrierName: 'Transportadora da Ordem',
  driverName: 'Motorista da Ordem',
  driverCpf: '86288366757',
  vehicles: [{ plate: 'ORD1A23', type: 'TRUCK_TRACTOR' }],
};

/** Ordem de 30 t publicada para a fazenda do João, com o transporte já informado. */
async function publishedOrder(page: Page) {
  const sellers = (await apiOk(page, 'GET', '/lookups/partners?role=SELLER&limit=20')).items as any[];
  const seller = sellers.find((s) => /jo[aã]o/i.test(s.label)) ?? sellers[0];
  const farm = ((await apiOk(page, 'GET', `/lookups/farms?sellerId=${seller.id}&limit=5`)).items as any[])[0];
  const buyer = ((await apiOk(page, 'GET', '/lookups/partners?role=BUYER&limit=20')).items as any[]).find((b) => /abc/i.test(b.label));
  const commodity = ((await apiOk(page, 'GET', '/lookups/commodities')).items as any[])[0];
  const unit = ((await apiOk(page, 'GET', '/lookups/units')) as any[]).find((u) => u.label === 't');
  const draft = await apiOk(page, 'POST', '/orders', {
    sellerPartnerId: seller.id,
    farmId: farm.id,
    buyerPartnerId: buyer.id,
    commodityId: commodity.id,
    unitId: unit.id,
    quantity: '30',
    loadingStartsOn: addDays(1),
    loadingEndsOn: addDays(30),
    ...TRANSPORT,
  });
  return apiOk(page, 'POST', `/orders/${draft.id}/publish`, { expectedUpdatedAt: draft.updatedAt });
}

/**
 * Não há liberação, agendamento nem criação manual de carga: a ordem publicada já autoriza carregar e
 * a Fazenda só informa que o caminhão chegou. É isso que cria a carga — o restante do fluxo
 * (carregamento, pesagem, notas, transporte, faturamento) segue na carga, como antes.
 */
test.describe('Chegada do caminhão', () => {
  test.skip(!password, 'Defina E2E_PASSWORD com a senha demo');

  test('a Fazenda informa a chegada com um clique e a carga nasce com o transporte da ordem', async ({ page, browser }) => {
    await login(page, 'admin@graoforte.demo');
    const order = await publishedOrder(page);
    expect(order.allowedActions).toContain('register_arrival');
    for (const gone of ['release', 'schedule', 'create_load', 'cancel_release']) expect(order.allowedActions).not.toContain(gone);

    // O que saiu, saiu também da API.
    expect((await api(page, 'POST', `/orders/${order.id}/releases`, { quantity: '5', expectedVersion: order.version })).status).toBe(404);
    expect((await api(page, 'POST', '/appointments', { orderId: order.id, scheduledOn: addDays(1), expectedQty: '5' })).status).toBe(404);
    expect((await api(page, 'POST', '/loads', { orderId: order.id, expectedQty: '5' })).status).toBe(404);
    expect((await api(page, 'GET', '/appointments')).status).toBe(404);
    expect((await api(page, 'GET', '/orders/releases')).status).toBe(404);

    // ─── Fazenda, pela tela da ordem ───
    const farm = await loginAs(browser, 'fazenda.joao@graoforte.demo');
    await farm.page.goto(`/ordens/${order.id}`);
    for (const name of ['Nova liberação', 'Novo agendamento', 'Nova carga']) await expect(farm.page.getByRole('button', { name })).toHaveCount(0);
    for (const href of ['/liberacoes', '/agendamentos', '/cargas']) await expect(farm.page.getByRole('navigation').first().locator(`a[href="${href}"]`)).toHaveCount(0);

    const created = farm.page.waitForResponse((r) => r.url().includes('/api/loads/arrival') && r.request().method() === 'POST');
    await farm.page.getByRole('button', { name: 'Informar chegada do caminhão' }).click();
    const response = await created;
    expect(response.status()).toBe(201);
    const load = await response.json();

    // A carga já abre na própria ordem, aguardando carregamento, com o transporte informado na ordem.
    await expect(farm.page).toHaveURL(new RegExp(`/ordens/${order.id}\\?carga=${load.id}`));
    const drawer = farm.page.getByRole('dialog').first();
    await expect(drawer.getByText(load.number).first()).toBeVisible({ timeout: 15_000 });
    expect(load).toMatchObject({ status: 'AWAITING_LOADING', driverName: TRANSPORT.driverName, driverCpf: TRANSPORT.driverCpf, carrierName: TRANSPORT.carrierName, plates: ['ORD1A23'] });
    expect(load.number).toBe(`${order.number}-C01`);

    // ─── Sem limite: a Fazenda carrega o que chegou, mesmo acima da quantidade da ordem ───
    const move = async (to: string, extra: Record<string, unknown> = {}) => {
      const current = await apiOk(farm.page, 'GET', `/loads/${load.id}`);
      return api(farm.page, 'POST', `/loads/${load.id}/transition`, { to, expectedUpdatedAt: current.updatedAt, ...extra });
    };
    // ─── Botão da próxima etapa, no topo da ordem ───
    await farm.page.keyboard.press('Escape');
    await expect(farm.page).not.toHaveURL(/carga=/);
    const started = farm.page.waitForResponse((r) => r.url().includes(`/loads/${load.id}/transition`) && r.request().method() === 'POST');
    // Etapa que não pede dados anda com um clique…
    await farm.page.getByRole('button', { name: /Iniciar carregamento\s*C01/ }).click();
    expect((await started).ok()).toBe(true);
    // …e a que pede (peso bruto e tara) abre a carga no ponto certo.
    await farm.page.getByRole('button', { name: /Confirmar carregamento\s*C01/ }).click();
    await expect(farm.page).toHaveURL(new RegExp(`carga=${load.id}`));
    await expect(farm.page.getByRole('dialog').first().getByLabel('Peso bruto (kg)')).toBeVisible();
    // 40 t líquidas numa ordem de 30 t.
    const loaded = await move('LOADED', { grossKg: '58000', tareKg: '18000' });
    expect(loaded.status, JSON.stringify(loaded.json)).toBe(200);
    expect(loaded.json.status).toBe('AWAITING_FARM_INVOICE');
    const after = await apiOk(farm.page, 'GET', `/orders/${order.id}`);
    expect(after.status).toBe('IN_PROGRESS');
    expect(Number(after.quantities.loaded)).toBe(40);

    // Um segundo caminhão é só outro clique.
    const second = await apiOk(farm.page, 'POST', '/loads/arrival', { orderId: order.id });
    expect(second.number).toBe(`${order.number}-C02`);

    // A chegada fica na linha do tempo e na auditoria da ordem.
    const timeline = ((await apiOk(farm.page, 'GET', `/orders/${order.id}/timeline`)) as any[]).map((e) => e.action);
    expect(timeline).toContain('order.truck_arrived');
    await farm.context.close();

    // ─── Comprador acompanha, mas não informa chegada ───
    const buyer = await loginAs(browser, 'comprador.abc@graoforte.demo');
    const asBuyer = await apiOk(buyer.page, 'GET', `/orders/${order.id}`);
    expect(asBuyer.allowedActions).not.toContain('register_arrival');
    expect((await api(buyer.page, 'POST', '/loads/arrival', { orderId: order.id })).status).toBe(403);
    await buyer.page.goto(`/ordens/${order.id}`);
    await expect(buyer.page.getByRole('button', { name: 'Informar chegada do caminhão' })).toHaveCount(0);
    await buyer.context.close();

    // ─── Links antigos continuam chegando a algum lugar ───
    await page.goto(`/cargas?abrir=${load.id}`);
    await expect(page).toHaveURL(new RegExp(`/ordens/${order.id}\\?carga=${load.id}`), { timeout: 20_000 });
    await page.goto('/agendamentos');
    await expect(page).toHaveURL(/\/ordens$/);
    await page.goto('/liberacoes');
    await expect(page).toHaveURL(/\/ordens$/);
  });
});
