import { expect, test, type Page } from '@playwright/test';
import { api, apiOk, login, loginAs, password } from './helpers';

const addDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

/** Q45: a Matriz conclui a ordem, com aceite explícito quando faltam PDF e XML da Fazenda. */
test.describe('Conclusão da ordem', () => {
  test.skip(!password, 'Defina E2E_PASSWORD com a senha demo');

  async function orderInProgress(page: Page) {
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
    let order = await apiOk(page, 'POST', `/orders/${draft.id}/releases`, { quantity: '60', expectedVersion: published.version });
    // Uma carga leva a ordem a "Em execução" e fica sem documentação fiscal.
    const created = await apiOk(page, 'POST', '/loads', { orderId: order.id, expectedQty: '30', loadingDate: addDays(1) });
    // Confirmar a carga coloca a ordem em execução.
    await apiOk(page, 'POST', `/loads/${created.id}/transition`, { to: 'CONFIRMED', expectedUpdatedAt: created.updatedAt });
    const load = await apiOk(page, 'GET', `/loads/${created.id}`);
    order = await apiOk(page, 'GET', `/orders/${order.id}`);
    return { order, load };
  }

  test('Conclusão exige cargas encerradas, aceite da documentação pendente e motivo com saldo', async ({ page, browser }) => {
    await login(page, 'admin@graoforte.demo');
    const { order, load } = await orderInProgress(page);
    expect(['PUBLISHED', 'IN_PROGRESS']).toContain(order.status);
    expect(order.allowedActions).toContain('complete');

    // Carga ativa bloqueia.
    let check = await apiOk(page, 'GET', `/orders/${order.id}/completion-check`);
    expect(check.activeLoads).toContain(load.number);
    let blocked = await api(page, 'POST', `/orders/${order.id}/complete`, { expectedUpdatedAt: order.updatedAt, acceptPendingDocuments: true, reason: 'Encerrada' });
    expect(blocked.status).toBe(422);
    expect(JSON.stringify(blocked.json)).toContain('carga(s) em andamento');

    // Encerrada a carga (cancelada), sobra saldo e a documentação da carga não existe.
    const current = await apiOk(page, 'GET', `/loads/${load.id}`);
    await apiOk(page, 'POST', `/loads/${load.id}/transition`, { to: 'CANCELLED', expectedUpdatedAt: current.updatedAt, notes: 'Veículo não compareceu' });
    let fresh = await apiOk(page, 'GET', `/orders/${order.id}`);
    check = await apiOk(page, 'GET', `/orders/${fresh.id}/completion-check`);
    expect(check.activeLoads).toEqual([]);
    expect(Number(check.balance)).toBeGreaterThan(0);

    // Sem motivo, com saldo: recusado.
    const noReason = await api(page, 'POST', `/orders/${fresh.id}/complete`, { expectedUpdatedAt: fresh.updatedAt, acceptPendingDocuments: true });
    expect(noReason.status).toBe(422);
    expect(JSON.stringify(noReason.json)).toContain('motivo');

    // Fazenda não conclui.
    const farm = await loginAs(browser, 'fazenda.joao@graoforte.demo');
    expect((await api(farm.page, 'POST', `/orders/${fresh.id}/complete`, { expectedUpdatedAt: fresh.updatedAt })).status).toBe(403);
    await farm.context.close();

    // Pela tela: diálogo com a conferência e confirmação.
    await page.goto(`/ordens/${fresh.id}`);
    await page.getByRole('button', { name: 'Concluir ordem' }).click();
    const dialog = page.getByRole('dialog', { name: 'Concluir ordem' });
    await expect(dialog.getByText(/Saldo a carregar/)).toBeVisible();
    const confirm = dialog.getByRole('button', { name: 'Concluir ordem' });
    await expect(confirm).toBeDisabled();
    await dialog.getByLabel(/Motivo/).fill('Contrato encerrado com o volume carregado');
    await expect(confirm).toBeEnabled();
    await confirm.click();
    await expect(page.getByText('Concluída', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Motivo da conclusão')).toBeVisible();

    fresh = await apiOk(page, 'GET', `/orders/${fresh.id}`);
    expect(fresh).toMatchObject({ status: 'COMPLETED', completionReason: 'Contrato encerrado com o volume carregado' });
    expect(fresh.completedAt).not.toBeNull();
    expect(fresh.allowedActions).not.toContain('complete');
    // Liberação ativa é encerrada junto.
    expect((fresh.releases as any[]).every((r) => r.status !== 'ACTIVE')).toBe(true);

    const audit = await apiOk(page, 'GET', '/audit?action=order.completed&pageSize=5');
    expect((audit.items as any[]).some((e) => e.entityId === fresh.id && e.after.via === 'manual')).toBe(true);
  });

  test('Conferência aponta cargas sem PDF e XML da Fazenda', async ({ page }) => {
    await login(page, 'admin@graoforte.demo');
    const { order, load } = await orderInProgress(page);
    const check = await apiOk(page, 'GET', `/orders/${order.id}/completion-check`);
    expect(check.pendingDocuments.map((l: any) => l.number)).toContain(load.number);
    expect(check.pendingDocuments[0].issues.join(' ')).toMatch(/PDF|XML|pesagem|Documenta/i);
    expect(check.activeLoads).toContain(load.number);

    // Com carga em andamento a conclusão é recusada mesmo com aceite.
    const refused = await api(page, 'POST', `/orders/${order.id}/complete`, {
      expectedUpdatedAt: order.updatedAt,
      reason: 'Encerrar sem documentação',
      acceptPendingDocuments: true,
    });
    expect(refused.status).toBe(422);
    expect(JSON.stringify(refused.json)).toContain('carga(s) em andamento');
  });
});
