import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { api, apiOk, login, loginAs, password } from './helpers';

const addDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

/**
 * Fluxo Q41: Comprador cria e envia a solicitação → Faturamento define fazenda e publica → Fazenda registra a chegada,
 * confirma o carregamento e fica bloqueada até anexar a documentação fiscal. Isolamento, auditoria e notificações.
 */
test.describe('Solicitação do Comprador', () => {
  test.skip(!password, 'Defina E2E_PASSWORD com a senha demo');

  test('Comprador solicita, Faturamento publica para a Fazenda e a Fazenda carrega', async ({ page, browser }) => {
    const stamp = Date.now();
    await login(page, 'comprador.abc@graoforte.demo');

    // ─── Formulário do portal: sem vendedor, fazenda ou campos internos ───
    await page.goto('/ordens?nova=1');
    const form = page.getByRole('dialog', { name: /Nova solicitação de ordem/ });
    await expect(form.getByRole('button', { name: 'Enviar ao Faturamento' })).toBeVisible();
    await expect(form.getByText(/Vendedor|Fazenda \/ propriedade|Preço|Observação interna/)).toHaveCount(0);
    await page.keyboard.press('Escape');

    const commodities = (await apiOk(page, 'GET', '/lookups/commodities')).items as any[];
    const commodity = commodities.find((c) => /milho/i.test(c.label)) ?? commodities[0];
    const unit = ((await apiOk(page, 'GET', '/lookups/units')) as any[]).find((u) => u.label === 't');
    const base = {
      commodityId: commodity.id,
      quantity: '60',
      unitId: unit.id,
      loadingStartsOn: addDays(1),
      loadingEndsOn: addDays(25),
      destinationName: `Unidade E2E ${stamp}`,
      destinationCity: 'Castro',
      destinationState: 'PR',
      freightMode: 'FOB',
      // O transporte é digitado pelo próprio Comprador na solicitação (ADR-010).
      carrierName: 'Trans Agro Logística',
      driverName: 'Antônio Pereira',
      driverCpf: '39053344705',
      vehicles: [{ plate: 'RVG1A23', type: 'TRUCK_TRACTOR' }],
      buyerNotes: 'Recebimento até 17h',
    };

    // Payload estrito: nada de fazenda, vendedor, comprador livre ou preço; endpoint administrativo negado.
    for (const extra of [{ farmId: randomUUID() }, { sellerPartnerId: randomUUID() }, { buyerPartnerId: randomUUID() }, { unitPrice: '10.00' }, { status: 'PUBLISHED' }]) {
      const res = await api(page, 'POST', '/orders/buyer', { ...base, ...extra });
      expect(res.status, JSON.stringify(extra)).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
    }
    expect((await api(page, 'POST', '/orders', base)).status).toBe(403);

    const draft = await apiOk(page, 'POST', '/orders/buyer', base);
    expect(draft).toMatchObject({ status: 'DRAFT', origin: 'BUYER', farm: null, seller: null });
    expect(draft.buyer?.name).toBeTruthy();
    expect(draft.transport.carrierName).toBe('Trans Agro Logística');
    expect(draft.transport.driverCpf).toBe('39053344705');
    expect(draft.transport.plates).toEqual(['RVG1A23']);
    expect(draft.allowedActions).toEqual(expect.arrayContaining(['buyer_edit', 'submit']));
    const edited = await apiOk(page, 'PATCH', `/orders/buyer/${draft.id}`, { expectedUpdatedAt: draft.updatedAt, data: { quantity: '70' } });
    expect(edited.quantities.total).toBe('70');

    // ─── Envio pelo detalhe ───
    await page.goto(`/ordens/${draft.id}`);
    await page.getByRole('button', { name: 'Enviar ao Faturamento' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Aguardando faturamento' })).toBeVisible();
    const sent = await apiOk(page, 'GET', `/orders/${draft.id}`);
    expect(sent.status).toBe('PENDING_BILLING');
    expect(sent.submittedBy).toBeTruthy();
    expect(sent.allowedActions).not.toContain('buyer_edit');

    // Após o envio: somente leitura para o Comprador.
    expect((await api(page, 'PATCH', `/orders/buyer/${draft.id}`, { expectedUpdatedAt: sent.updatedAt, data: { quantity: '80' } })).status).toBe(422);
    expect((await api(page, 'POST', `/orders/${draft.id}/submit`, { expectedUpdatedAt: sent.updatedAt })).status).toBe(422);
    const buyerTimeline = (await apiOk(page, 'GET', `/orders/${draft.id}/timeline`)) as any[];
    expect(buyerTimeline.map((e) => e.action)).toContain('order.submitted');

    // ─── Isolamento: outro comprador e a Fazenda não acessam ───
    const otherBuyer = await loginAs(browser, 'comprador.nutri@graoforte.demo');
    expect((await api(otherBuyer.page, 'GET', `/orders/${draft.id}`)).status).toBe(404);
    await otherBuyer.context.close();
    const farm = await loginAs(browser, 'fazenda.joao@graoforte.demo');
    expect((await api(farm.page, 'GET', `/orders/${draft.id}`)).status).toBe(404);

    // ─── Faturamento ───
    const billing = await loginAs(browser, 'faturamento@graoforte.demo');
    const queue = (await apiOk(billing.page, 'GET', '/orders?status=PENDING_BILLING&pageSize=200')).items as any[];
    expect(queue.map((o) => o.id)).toContain(draft.id);
    await expect
      .poll(async () => ((await apiOk(billing.page, 'GET', '/notifications')).items as any[]).some((n) => n.title.includes(sent.number)), { timeout: 30_000 })
      .toBe(true);

    let review = await apiOk(billing.page, 'GET', `/orders/${draft.id}`);
    expect(review.allowedActions).toContain('assign_farm');
    expect(review.allowedActions).not.toContain('billing_publish');
    expect((await api(billing.page, 'POST', `/orders/${draft.id}/billing/publish`, { expectedUpdatedAt: review.updatedAt })).status).toBe(422);
    // Publicação comum não serve para solicitações do Comprador: o Faturamento publica pela análise (Q40 revisada:
    // o papel pode publicar ordens da Matriz, então a recusa é de regra, não de permissão).
    expect((await api(billing.page, 'POST', `/orders/${draft.id}/publish`, { expectedUpdatedAt: review.updatedAt })).status).toBe(422);

    const sellers = (await apiOk(billing.page, 'GET', '/lookups/partners?role=SELLER&limit=20')).items as any[];
    const seller = sellers.find((s) => /jo[aã]o/i.test(s.label)) ?? sellers.find((s) => Number(s.meta?.farms ?? 0) > 0);
    const farmOption = ((await apiOk(billing.page, 'GET', `/lookups/farms?sellerId=${seller.id}&limit=5`)).items as any[])[0];
    review = await apiOk(billing.page, 'POST', `/orders/${draft.id}/billing/assign`, {
      expectedUpdatedAt: review.updatedAt,
      sellerPartnerId: seller.id,
      farmId: farmOption.id,
      farmNotes: 'Carregar pela manhã',
    });
    expect(review.status).toBe('PENDING_BILLING');
    expect(review.farm?.id).toBe(farmOption.id);
    // Fazenda definida, mas ainda em análise: a Fazenda continua sem acesso.
    expect((await api(farm.page, 'GET', `/orders/${draft.id}`)).status).toBe(404);

    await billing.page.goto(`/ordens/${draft.id}`);
    await billing.page.getByRole('button', { name: 'Publicar para a Fazenda' }).click();
    await expect.poll(async () => (await apiOk(billing.page, 'GET', `/orders/${draft.id}`)).status).toBe('PUBLISHED');
    await billing.context.close();

    // ─── Fazenda recebe e acessa; Comprador acompanha ───
    const published = await apiOk(farm.page, 'GET', `/orders/${draft.id}`);
    expect(published.status).toBe('PUBLISHED');
    await expect
      .poll(async () => ((await apiOk(farm.page, 'GET', '/notifications')).items as any[]).some((n) => n.title.includes(sent.number)), { timeout: 30_000 })
      .toBe(true);
    expect((await apiOk(page, 'GET', `/orders/${draft.id}`)).status).toBe('PUBLISHED');

    const admin = await loginAs(browser, 'admin@graoforte.demo');
    const audit = (await apiOk(admin.page, 'GET', `/audit?entityType=loading_order&entityId=${draft.id}&pageSize=100`)).items as any[];
    expect(audit.map((e) => e.action)).toEqual(expect.arrayContaining(['order.created', 'order.draft_saved', 'order.submitted', 'order.farm_assigned', 'order.published', 'order.version_created'].filter((a) => a !== 'order.version_created')));

    // Liberação da Matriz para a Fazenda operar.
    const withVersion = await apiOk(admin.page, 'GET', `/orders/${draft.id}`);
    await apiOk(admin.page, 'POST', `/orders/${draft.id}/releases`, { quantity: '40', expectedVersion: withVersion.version });

    // ─── Fazenda: chegada do veículo, carga e carregamento ───
    await admin.context.close();

    // Sem repetir o transporte: o agendamento nasce com o que o Comprador digitou na ordem.
    const appointment = await apiOk(farm.page, 'POST', '/appointments', { orderId: draft.id, scheduledOn: addDays(1), expectedQty: '12' });
    expect(appointment.driverCpf, 'agendamento herda o transporte digitado na ordem').toBe('39053344705');
    await apiOk(farm.page, 'POST', `/appointments/${appointment.id}/transition`, { to: 'CONFIRMED' });
    expect((await api(farm.page, 'POST', `/appointments/${appointment.id}/transition`, { to: 'CONVERTED' })).status).toBe(422);
    await apiOk(farm.page, 'POST', `/appointments/${appointment.id}/transition`, { to: 'CHECKED_IN' });
    const converted = await apiOk(farm.page, 'POST', `/appointments/${appointment.id}/transition`, { to: 'CONVERTED' });

    const move = async (to: string, extra: Record<string, unknown> = {}) => {
      const current = await apiOk(farm.page, 'GET', `/loads/${converted.loadId}`);
      return api(farm.page, 'POST', `/loads/${converted.loadId}/transition`, { to, expectedUpdatedAt: current.updatedAt, ...extra });
    };
    expect((await apiOk(farm.page, 'GET', `/loads/${converted.loadId}`)).status).toBe('AWAITING_LOADING');
    expect((await move('LOADING')).status).toBe(200);
    expect((await move('LOADED')).status).toBe(422);
    const loaded = await move('LOADED', { grossKg: '30000', tareKg: '18000' });
    expect(loaded.status).toBe(200);
    expect(loaded.json.status).toBe('AWAITING_FARM_INVOICE');

    // Sem PDF e XML válidos, a carga não segue.
    const docs = await move('FARM_INVOICED');
    expect(docs.status).toBe(422);
    expect(docs.json.error.code).toBe('FISCAL_DOCUMENTS_REQUIRED');
    expect((await move('IN_TRANSIT')).status).toBe(422);
    await farm.context.close();
  });
});
