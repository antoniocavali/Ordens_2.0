import { expect, test, type Page } from '@playwright/test';
import { api, apiOk, login, loginAs, password } from './helpers';

const addDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

/** Q41: Faturamento devolve com motivo; Comprador ajusta e reenvia; Comprador cancela antes da análise (e não depois). */
test.describe('Devolução e cancelamento de solicitações', () => {
  test.skip(!password, 'Defina E2E_PASSWORD com a senha demo');

  async function newRequest(page: Page, label: string) {
    const commodity = ((await apiOk(page, 'GET', '/lookups/commodities')).items as any[])[0];
    const unit = ((await apiOk(page, 'GET', '/lookups/units')) as any[]).find((u) => u.label === 't');
    // Transportadora preferencial é opcional.
    const draft = await apiOk(page, 'POST', '/orders/buyer', {
      commodityId: commodity.id,
      quantity: '35',
      unitId: unit.id,
      loadingStartsOn: addDays(2),
      loadingEndsOn: addDays(15),
      destinationName: label,
    });
    return apiOk(page, 'POST', `/orders/${draft.id}/submit`, { expectedUpdatedAt: draft.updatedAt });
  }

  const notified = (page: Page, text: string) =>
    expect.poll(async () => ((await apiOk(page, 'GET', '/notifications')).items as any[]).some((n) => n.title.includes(text)), { timeout: 30_000 }).toBe(true);

  test('Faturamento devolve, Comprador reenvia e cancela antes da análise', async ({ page, browser }) => {
    const stamp = Date.now();
    await login(page, 'comprador.abc@graoforte.demo');
    const sent = await newRequest(page, `Devolução E2E ${stamp}`);
    expect(sent.status).toBe('PENDING_BILLING');
    expect(sent.allowedActions).toContain('buyer_cancel');

    // ─── Devolução pelo Faturamento (motivo obrigatório) ───
    const billing = await loginAs(browser, 'faturamento@graoforte.demo');
    expect((await api(billing.page, 'POST', `/orders/${sent.id}/billing/return`, { expectedUpdatedAt: sent.updatedAt, reason: '' })).status).toBeGreaterThanOrEqual(400);
    await billing.page.goto(`/ordens/${sent.id}`);
    await billing.page.getByRole('button', { name: 'Devolver ao Comprador' }).click();
    const dialog = billing.page.getByRole('dialog', { name: 'Devolver ao Comprador' });
    await dialog.getByLabel(/Motivo/).fill('Janela de carregamento curta demais para o volume');
    await dialog.getByRole('button', { name: 'Devolver ao Comprador' }).click();
    await expect.poll(async () => (await apiOk(billing.page, 'GET', `/orders/${sent.id}`)).status).toBe('DRAFT');
    const returned = await apiOk(billing.page, 'GET', `/orders/${sent.id}`);
    expect(returned).toMatchObject({ returnReason: 'Janela de carregamento curta demais para o volume', farm: null, seller: null, submittedAt: null });
    expect(returned.allowedActions).not.toContain('return_to_buyer');

    // ─── Comprador vê o motivo, ajusta e reenvia pela tela ───
    await notified(page, `${sent.number} devolvida`);
    await page.goto(`/ordens/${sent.id}`);
    await expect(page.getByRole('status').filter({ hasText: 'Devolvida pelo Faturamento' })).toContainText('Janela de carregamento curta demais');
    const draft = await apiOk(page, 'GET', `/orders/${sent.id}`);
    await apiOk(page, 'PATCH', `/orders/buyer/${sent.id}`, { expectedUpdatedAt: draft.updatedAt, data: { loadingEndsOn: addDays(40) } });
    await page.reload();
    await page.getByRole('button', { name: 'Enviar ao Faturamento' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Aguardando faturamento' })).toBeVisible();

    // ─── Cancelamento pelo Comprador antes da análise ───
    await page.getByRole('button', { name: 'Cancelar solicitação' }).click();
    const cancelDialog = page.getByRole('dialog', { name: 'Cancelar solicitação' });
    await cancelDialog.getByLabel(/Motivo/).fill('Compra suspensa pelo cliente');
    await cancelDialog.getByRole('button', { name: 'Cancelar solicitação' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Solicitação cancelada' })).toContainText('Compra suspensa pelo cliente');
    expect((await apiOk(page, 'GET', `/orders/${sent.id}`)).status).toBe('CANCELLED');
    await notified(billing.page, `${sent.number} cancelada pelo Comprador`);

    const timeline = ((await apiOk(page, 'GET', `/orders/${sent.id}/timeline`)) as any[]).map((e) => e.action);
    expect(timeline).toEqual(expect.arrayContaining(['order.submitted', 'order.returned', 'order.cancelled_by_buyer']));

    // ─── Depois da análise iniciada (fazenda definida), o Comprador não cancela ───
    const other = await newRequest(page, `Em análise E2E ${stamp}`);
    const sellers = (await apiOk(billing.page, 'GET', '/lookups/partners?role=SELLER&limit=20')).items as any[];
    const seller = sellers.find((s) => Number(s.meta?.farms ?? 0) > 0);
    const farmOption = ((await apiOk(billing.page, 'GET', `/lookups/farms?sellerId=${seller.id}&limit=5`)).items as any[])[0];
    const review = await apiOk(billing.page, 'GET', `/orders/${other.id}`);
    await apiOk(billing.page, 'POST', `/orders/${other.id}/billing/assign`, { expectedUpdatedAt: review.updatedAt, sellerPartnerId: seller.id, farmId: farmOption.id });
    const analysed = await apiOk(page, 'GET', `/orders/${other.id}`);
    expect(analysed.allowedActions).not.toContain('buyer_cancel');
    const denied = await api(page, 'POST', `/orders/${other.id}/buyer-cancel`, { expectedUpdatedAt: analysed.updatedAt, reason: 'Tentativa tardia' });
    expect(denied.status).toBe(422);

    // Outro comprador não cancela nem devolve.
    const nutri = await loginAs(browser, 'comprador.nutri@graoforte.demo');
    expect((await api(nutri.page, 'POST', `/orders/${other.id}/buyer-cancel`, { expectedUpdatedAt: analysed.updatedAt, reason: 'Invasão' })).status).toBe(404);
    expect((await api(nutri.page, 'POST', `/orders/${other.id}/billing/return`, { expectedUpdatedAt: analysed.updatedAt, reason: 'Invasão' })).status).toBe(403);
    await nutri.context.close();

    await billing.context.close();
    // Auditoria (consulta exige audit.read: Administrador).
    const admin = await loginAs(browser, 'admin@graoforte.demo');
    const audit = (await apiOk(admin.page, 'GET', `/audit?entityType=loading_order&entityId=${sent.id}&pageSize=50`)).items as any[];
    expect(audit.map((e) => e.action)).toEqual(expect.arrayContaining(['order.returned', 'order.cancelled_by_buyer']));
    await admin.context.close();
  });
});
