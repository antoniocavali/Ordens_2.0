import { expect, test } from '@playwright/test';
import { api, apiOk, login, password } from './helpers';

const addDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

/** Correções da revisão de segurança de 17/09/2026 (relatório em tmp/seguranca). */
test.describe('Revisão de segurança', () => {
  test.skip(!password, 'Defina E2E_PASSWORD com a senha demo');

  test('3.2 — chegadas simultâneas não geram cargas com o mesmo número', async ({ page }) => {
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
    // Oito caminhões "chegando" ao mesmo tempo: a ordem é bloqueada durante cada registro, então
    // todos entram, cada um com a sua sequência — sem número de carga repetido.
    const attempts = await Promise.all(Array.from({ length: 8 }, () => api(page, 'POST', '/loads/arrival', { orderId: published.id })));
    expect(attempts.map((a) => a.status), JSON.stringify(attempts.map((a) => a.json))).toEqual(Array(8).fill(201));
    const numbers = attempts.map((a) => a.json.number as string);
    expect(new Set(numbers).size).toBe(8);

    const loads = (await apiOk(page, 'GET', `/loads?orderId=${published.id}&pageSize=50`)).items as any[];
    expect(loads).toHaveLength(8);
  });
});
