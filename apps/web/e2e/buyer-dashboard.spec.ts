import { expect, test } from '@playwright/test';
import { apiOk, login, loginAs, password } from './helpers';

const addDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

/** Painel do Comprador: funil das próprias solicitações e cargas a caminho; blocos exclusivos do perfil. */
test.describe('Painel do Comprador', () => {
  test.skip(!password, 'Defina E2E_PASSWORD com a senha demo');

  test('Comprador acompanha solicitações e cargas a caminho; Matriz não recebe o bloco', async ({ page, browser }) => {
    await login(page, 'comprador.abc@graoforte.demo');
    const before = await apiOk(page, 'GET', '/dashboard?period=30d');
    expect(before.scope).toBe('BUYER');
    expect(before.carriers).toEqual([]);

    // Nova solicitação enviada soma em "Aguardando faturamento".
    const commodity = ((await apiOk(page, 'GET', '/lookups/commodities')).items as any[])[0];
    const unit = ((await apiOk(page, 'GET', '/lookups/units')) as any[]).find((u) => u.label === 't');
    const draft = await apiOk(page, 'POST', '/orders/buyer', { commodityId: commodity.id, unitId: unit.id, quantity: '30', loadingStartsOn: addDays(2), loadingEndsOn: addDays(20) });
    let after = await apiOk(page, 'GET', '/dashboard?period=30d');
    expect(after.buyer.requests.draft).toBe(before.buyer.requests.draft + 1);
    await apiOk(page, 'POST', `/orders/${draft.id}/submit`, { expectedUpdatedAt: draft.updatedAt });
    after = await apiOk(page, 'GET', '/dashboard?period=30d');
    expect(after.buyer.requests.pendingBilling).toBe(before.buyer.requests.pendingBilling + 1);
    expect(after.buyer.requests.draft).toBe(before.buyer.requests.draft);

    // Cargas a caminho: só do próprio Comprador.
    const transit = (await apiOk(page, 'GET', '/loads?status=IN_TRANSIT&status=ARRIVED&pageSize=100')).items as any[];
    expect(after.buyer.inbound.length).toBe(Math.min(transit.length, 8));
    for (const l of after.buyer.inbound) expect(transit.map((t) => t.id)).toContain(l.id);

    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Minhas solicitações' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'A caminho' })).toBeVisible();
    await expect(page.getByRole('link', { name: /Aguardando faturamento/ }).first()).toBeVisible();
    await expect(page.getByText('Tempo médio até a publicação')).toBeVisible();
    await page.screenshot({ path: 'test-results/buyer-dashboard.png', fullPage: true });

    const admin = await loginAs(browser, 'admin@graoforte.demo');
    expect((await apiOk(admin.page, 'GET', '/dashboard')).buyer).toBeNull();
    await admin.context.close();
  });
});
