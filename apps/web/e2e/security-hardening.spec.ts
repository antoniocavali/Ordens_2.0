import { expect, test } from '@playwright/test';
import { api, apiOk, login, password } from './helpers';

const addDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

/** Correções da revisão de segurança de 17/09/2026 (relatório em tmp/seguranca). */
test.describe('Revisão de segurança', () => {
  test.skip(!password, 'Defina E2E_PASSWORD com a senha demo');

  test('3.2 — cargas simultâneas não ultrapassam o saldo liberado', async ({ page }) => {
    await login(page, 'admin@graoforte.demo');
    const sellers = (await apiOk(page, 'GET', '/lookups/partners?role=SELLER&limit=20')).items as any[];
    const seller = sellers.find((s) => /jo[aã]o/i.test(s.label)) ?? sellers[0];
    const farm = ((await apiOk(page, 'GET', `/lookups/farms?sellerId=${seller.id}&limit=5`)).items as any[])[0];
    const buyer = ((await apiOk(page, 'GET', '/lookups/partners?role=BUYER&limit=20')).items as any[])[0];
    const commodity = ((await apiOk(page, 'GET', '/lookups/commodities')).items as any[])[0];
    const unit = ((await apiOk(page, 'GET', '/lookups/units')) as any[]).find((u) => u.label === 't');
    const draft = await apiOk(page, 'POST', '/orders', {
      sellerPartnerId: seller.id, farmId: farm.id, buyerPartnerId: buyer.id, commodityId: commodity.id, unitId: unit.id,
      quantity: '100', loadingStartsOn: addDays(1), loadingEndsOn: addDays(30),
    });
    const published = await apiOk(page, 'POST', `/orders/${draft.id}/publish`, { expectedUpdatedAt: draft.updatedAt });
    const order = await apiOk(page, 'POST', `/orders/${draft.id}/releases`, { quantity: '60', expectedVersion: published.version });

    // Oito pedidos simultâneos de 40 t sobre 60 t liberadas: só um pode passar.
    const attempts = await Promise.all(
      Array.from({ length: 8 }, () => api(page, 'POST', '/loads', { orderId: order.id, expectedQty: '40', loadingDate: addDays(1) })),
    );
    const created = attempts.filter((r) => r.status === 201 || r.status === 200);
    expect(created, JSON.stringify(attempts.map((a) => a.status))).toHaveLength(1);
    expect(attempts.filter((r) => r.status === 422).length).toBe(7);

    const fresh = await apiOk(page, 'GET', `/orders/${order.id}`);
    expect(Number(fresh.quantities.scheduled)).toBeLessThanOrEqual(60);
  });
});
