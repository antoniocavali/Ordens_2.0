import { expect, test, type Page } from '@playwright/test';
import { apiOk, login, loginAs, password } from './helpers';

const MAILPIT = process.env.MAILPIT_URL ?? `http://localhost:${process.env.MAILPIT_UI_HOST_PORT ?? '8025'}`;
const addDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

async function mailsFor(to: string, subject: string): Promise<{ ID: string; Subject: string }[]> {
  const r = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${to}" subject:"${subject}"`)}`);
  if (!r.ok) return [];
  return ((await r.json()) as { messages: { ID: string; Subject: string }[] }).messages;
}

async function publishedOrderForAbc(page: Page) {
  const sellers = (await apiOk(page, 'GET', '/lookups/partners?role=SELLER&limit=20')).items as any[];
  const seller = sellers.find((s) => /jo[aã]o/i.test(s.label)) ?? sellers[0];
  const farm = ((await apiOk(page, 'GET', `/lookups/farms?sellerId=${seller.id}&limit=5`)).items as any[])[0];
  const buyer = ((await apiOk(page, 'GET', '/lookups/partners?role=BUYER&limit=20')).items as any[]).find((b) => /abc/i.test(b.label));
  const commodity = ((await apiOk(page, 'GET', '/lookups/commodities')).items as any[])[0];
  const unit = ((await apiOk(page, 'GET', '/lookups/units')) as any[]).find((u) => u.label === 't');
  const draft = await apiOk(page, 'POST', '/orders', {
    sellerPartnerId: seller.id, farmId: farm.id, buyerPartnerId: buyer.id, commodityId: commodity.id, unitId: unit.id,
    quantity: '50', loadingStartsOn: addDays(1), loadingEndsOn: addDays(20),
  });
  return apiOk(page, 'POST', `/orders/${draft.id}/publish`, { expectedUpdatedAt: draft.updatedAt });
}

/** Q44: avisos por e-mail conforme as preferências de cada usuário. */
test.describe('Notificações por e-mail', () => {
  test.skip(!password, 'Defina E2E_PASSWORD com a senha demo');

  test('Comprador recebe o e-mail da suspensão e deixa de receber o da retomada ao desligar o tipo', async ({ page, browser }) => {
    const buyerEmail = 'comprador.abc@graoforte.demo';
    await login(page, buyerEmail);
    // Estado conhecido: padrão (tudo ligado conforme o catálogo).
    const defaults = await apiOk(page, 'GET', '/me/notification-preferences');
    await apiOk(page, 'PUT', '/me/notification-preferences', { enabled: true, types: { ...defaults.types, 'order.suspended': true, 'order.resumed': true } });

    // Tela: só os tipos do perfil; desliga "Ordem retomada".
    await page.goto('/conta/seguranca');
    await expect(page.getByRole('heading', { name: 'Notificações por e-mail' })).toBeVisible();
    await expect(page.getByLabel('Solicitação devolvida para ajuste')).toBeChecked();
    await expect(page.getByLabel('Pedido de publicação para aprovar')).toHaveCount(0);
    await page.getByLabel('Ordem retomada').uncheck();
    await page.getByRole('button', { name: 'Salvar preferências' }).click();
    await expect(page.getByText('Preferências de e-mail salvas')).toBeVisible();
    expect((await apiOk(page, 'GET', '/me/notification-preferences')).types['order.resumed']).toBe(false);

    const admin = await loginAs(browser, 'admin@graoforte.demo');
    let order = await publishedOrderForAbc(admin.page);
    order = await apiOk(admin.page, 'POST', `/orders/${order.id}/suspend`, { expectedUpdatedAt: order.updatedAt, reason: 'Conferência de qualidade do lote' });
    await expect.poll(async () => (await mailsFor(buyerEmail, `Ordem ${order.number} suspensa`)).length, { timeout: 45_000 }).toBe(1);

    order = await apiOk(admin.page, 'POST', `/orders/${order.id}/resume`, { expectedUpdatedAt: order.updatedAt });
    // O aviso no sistema chega; o e-mail não.
    await expect
      .poll(async () => ((await apiOk(page, 'GET', '/notifications')).items as any[]).some((n) => n.title.includes(`${order.number} retomada`)), { timeout: 45_000 })
      .toBe(true);
    await page.waitForTimeout(3_000);
    expect(await mailsFor(buyerEmail, `Ordem ${order.number} retomada`)).toHaveLength(0);

    const audit = await apiOk(admin.page, 'GET', '/audit?action=user.notification_preferences_updated&pageSize=5');
    expect((audit.items as any[]).length).toBeGreaterThan(0);
    await admin.context.close();
  });
});
