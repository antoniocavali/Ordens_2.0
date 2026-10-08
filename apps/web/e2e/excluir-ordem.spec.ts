import { expect, test, type Page } from '@playwright/test';
import { api, apiOk, login, loginAs, nfeKey, nfeXml, password, PDF } from './helpers';

const addDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

const TRANSPORT = {
  carrierName: 'Transportadora da Ordem',
  driverName: 'Motorista da Ordem',
  driverCpf: '86288366757',
  vehicles: [{ plate: 'EXC1A23', type: 'TRUCK_TRACTOR' }],
};

/** Rascunho de 30 t para a fazenda do João, com o transporte já informado. */
async function draftOrder(page: Page) {
  const sellers = (await apiOk(page, 'GET', '/lookups/partners?role=SELLER&limit=20')).items as any[];
  const seller = sellers.find((s) => /jo[aã]o/i.test(s.label)) ?? sellers[0];
  const farm = ((await apiOk(page, 'GET', `/lookups/farms?sellerId=${seller.id}&limit=5`)).items as any[])[0];
  const buyer = ((await apiOk(page, 'GET', '/lookups/partners?role=BUYER&limit=20')).items as any[]).find((b) => /abc/i.test(b.label));
  const commodity = ((await apiOk(page, 'GET', '/lookups/commodities')).items as any[])[0];
  const unit = ((await apiOk(page, 'GET', '/lookups/units')) as any[]).find((u) => u.label === 't');
  return apiOk(page, 'POST', '/orders', {
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
}
const publishedOrder = async (page: Page) => {
  const draft = await draftOrder(page);
  return apiOk(page, 'POST', `/orders/${draft.id}/publish`, { expectedUpdatedAt: draft.updatedAt });
};

test.describe('Etapa da Fazenda concluída', () => {
  test.skip(!password, 'Defina E2E_PASSWORD com a senha demo');

  test('ao concluir a validação fiscal a carga fecha e a ordem mostra que agora está com a Matriz', async ({ page, browser }) => {
    test.setTimeout(240_000);
    await login(page, 'admin@graoforte.demo');
    const order = await publishedOrder(page);
    const sellerDoc = String((await apiOk(page, 'GET', `/partners/${order.seller.id}`)).document ?? '').replace(/\D/g, '');

    const farm = await loginAs(browser, 'fazenda.joao@graoforte.demo');
    const load = await apiOk(farm.page, 'POST', '/loads/arrival', { orderId: order.id });
    const getLoad = () => apiOk(farm.page, 'GET', `/loads/${load.id}`);
    await farm.page.goto(`/ordens/${order.id}?carga=${load.id}`);
    const drawer = farm.page.getByRole('dialog').first();
    const advance = async (label: string) => {
      const response = farm.page.waitForResponse((r) => r.url().includes(`/loads/${load.id}/transition`) && r.request().method() === 'POST');
      await drawer.getByRole('button', { name: label, exact: true }).click();
      return response;
    };

    // Enquanto a vez é da Fazenda, a carga diz isso e o que falta.
    await expect(drawer.getByRole('status').filter({ hasText: 'Sua vez' })).toContainText('iniciar o carregamento');
    expect((await advance('Iniciar carregamento')).ok()).toBe(true);
    await drawer.getByLabel('Peso bruto (kg)').fill('48500');
    await drawer.getByLabel('Tara (kg)').fill('38500');
    expect((await advance('Confirmar carregamento')).ok()).toBe(true);

    const input = drawer.locator('input[type="file"]').first();
    await input.setInputFiles({ name: 'danfe.pdf', mimeType: 'application/pdf', buffer: PDF });
    const key = nfeKey(sellerDoc);
    await input.setInputFiles({ name: `NFe${key}.xml`, mimeType: 'application/xml', buffer: Buffer.from(nfeXml({ key, issuerDoc: sellerDoc, plate: 'EXC1A23', netKg: 10_000 })) });
    await expect.poll(async () => (await getLoad()).fiscalChecklist?.ready, { timeout: 60_000 }).toBe(true);
    await farm.page.reload();

    // O passo final da Fazenda chama-se "Concluir validação fiscal"…
    await expect(drawer.getByRole('button', { name: 'Validar documentação fiscal' })).toHaveCount(0);
    expect((await advance('Concluir validação fiscal')).ok()).toBe(true);

    // …e, feito, a carga fecha sozinha e a ordem diz que a parte da Fazenda terminou.
    await expect(farm.page.getByRole('dialog')).toHaveCount(0);
    await expect(farm.page).not.toHaveURL(/carga=/);
    const banner = farm.page.getByRole('status').filter({ hasText: 'Etapa da Fazenda concluída' });
    await expect(banner).toContainText(load.number);
    await expect(banner).toContainText('A carga agora está com a Matriz');
    // Nada mais a fazer no topo da ordem além de informar outro caminhão.
    await expect(farm.page.getByRole('button', { name: /Registrar faturamento|Concluir validação/ })).toHaveCount(0);

    // Na lista de cargas, a etapa também diz com quem está; reabrindo a carga, a faixa repete.
    await farm.page.getByRole('tab', { name: 'Cargas', exact: true }).click();
    const row = farm.page.getByRole('row', { name: new RegExp(load.number) });
    await expect(row).toContainText('Aguardando faturamento da Matriz');
    await row.click();
    await expect(farm.page.getByRole('dialog').first().getByRole('status').filter({ hasText: 'Etapa da Fazenda concluída' })).toBeVisible();

    // Para a Matriz, a mesma carga aparece como "Sua vez", com o botão do faturamento no topo.
    await page.goto(`/ordens/${order.id}`);
    await expect(page.getByRole('button', { name: /Registrar faturamento da Matriz\s*C01/ })).toBeVisible();
    await page.getByRole('button', { name: /Registrar faturamento da Matriz\s*C01/ }).click();
    await expect(page.getByRole('dialog').first().getByRole('status').filter({ hasText: 'Sua vez' })).toContainText('registrar o faturamento');
  });
});

test.describe('Exclusão de ordem', () => {
  test.skip(!password, 'Defina E2E_PASSWORD com a senha demo');

  test('Administrador exclui rascunho; Operador, Fazenda e Comprador não', async ({ page, browser }) => {
    await login(page, 'admin@graoforte.demo');
    const draft = await draftOrder(page);
    expect(draft.status).toBe('DRAFT');
    expect(draft.allowedActions).toContain('delete');
    const body = { expectedUpdatedAt: draft.updatedAt, reason: 'Lançada por engano' };

    // Operador da Matriz enxerga o rascunho, mas não tem a permissão.
    const operator = await loginAs(browser, 'operador@graoforte.demo');
    expect((await apiOk(operator.page, 'GET', `/orders/${draft.id}`)).allowedActions).not.toContain('delete');
    expect((await api(operator.page, 'POST', `/orders/${draft.id}/delete`, body)).status).toBe(403);
    await operator.page.goto(`/ordens/${draft.id}`);
    await expect(operator.page.getByRole('heading', { name: draft.number })).toBeVisible();
    await expect(operator.page.getByRole('button', { name: 'Excluir', exact: true })).toHaveCount(0);

    // Motivo é obrigatório, e a exclusão respeita a edição concorrente.
    expect((await api(page, 'POST', `/orders/${draft.id}/delete`, { expectedUpdatedAt: draft.updatedAt, reason: '' })).status).toBe(422);
    expect((await api(page, 'POST', `/orders/${draft.id}/delete`, { ...body, expectedUpdatedAt: new Date(0).toISOString() })).status).toBe(409);

    const removed = await api(page, 'POST', `/orders/${draft.id}/delete`, body);
    expect(removed.status, JSON.stringify(removed.json)).toBe(200);
    expect(removed.json.number).toBe(draft.number);
    expect((await api(page, 'GET', `/orders/${draft.id}`)).status).toBe(404);
    expect((await api(page, 'POST', `/orders/${draft.id}/delete`, body)).status).toBe(404);
  });

  test('Gestor exclui pela tela uma ordem com carga e documento; nada dela sobra e a auditoria guarda o motivo', async ({ page, browser }) => {
    test.setTimeout(180_000);
    await login(page, 'gestor@graoforte.demo');
    const order = await publishedOrder(page);
    const load = await apiOk(page, 'POST', '/loads/arrival', { orderId: order.id });

    // Um documento anexado à carga, para a exclusão ter o que levar junto.
    await page.goto(`/ordens/${order.id}?carga=${load.id}`);
    const drawer = page.getByRole('dialog').first();
    const moved = page.waitForResponse((r) => r.url().includes(`/loads/${load.id}/transition`) && r.request().method() === 'POST');
    await drawer.getByRole('button', { name: 'Iniciar carregamento', exact: true }).click();
    expect((await moved).ok()).toBe(true);
    await drawer.getByLabel('Peso bruto (kg)').fill('48500');
    await drawer.getByLabel('Tara (kg)').fill('38500');
    const loaded = page.waitForResponse((r) => r.url().includes(`/loads/${load.id}/transition`) && r.request().method() === 'POST');
    await drawer.getByRole('button', { name: 'Confirmar carregamento', exact: true }).click();
    expect((await loaded).ok()).toBe(true);
    await drawer.locator('input[type="file"]').first().setInputFiles({ name: 'danfe.pdf', mimeType: 'application/pdf', buffer: PDF });
    await expect.poll(async () => (await apiOk(page, 'GET', `/loads/${load.id}`)).fiscalChecklist?.pdf, { timeout: 60_000 }).toBe('OK');

    // A Fazenda e o Comprador da ordem a enxergam, mas não excluem.
    const farm = await loginAs(browser, 'fazenda.joao@graoforte.demo');
    const seenByFarm = await apiOk(farm.page, 'GET', `/orders/${order.id}`);
    expect(seenByFarm.allowedActions).not.toContain('delete');
    expect((await api(farm.page, 'POST', `/orders/${order.id}/delete`, { expectedUpdatedAt: seenByFarm.updatedAt, reason: 'tentativa' })).status).toBe(403);
    const buyer = await loginAs(browser, 'comprador.abc@graoforte.demo');
    expect((await api(buyer.page, 'POST', `/orders/${order.id}/delete`, { expectedUpdatedAt: seenByFarm.updatedAt, reason: 'tentativa' })).status).toBe(403);

    // Pela tela: motivo + digitar o número da ordem.
    await page.goto(`/ordens/${order.id}`);
    await page.getByRole('button', { name: 'Excluir', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Excluir ordem' });
    await expect(dialog).toContainText('Não há como desfazer');
    const confirm = dialog.getByRole('button', { name: 'Excluir definitivamente' });
    await dialog.getByLabel('Motivo').fill('Ordem de teste');
    await expect(confirm).toBeDisabled();
    await dialog.getByLabel(`Digite ${order.number} para confirmar`).fill(order.number);
    await confirm.click();
    await expect(page).toHaveURL(/\/ordens$/);
    await expect(page.getByText(`Ordem ${order.number} excluída`)).toBeVisible();

    // Nada dela sobra — para ninguém.
    expect((await api(page, 'GET', `/orders/${order.id}`)).status).toBe(404);
    expect((await api(page, 'GET', `/loads/${load.id}`)).status).toBe(404);
    expect(((await apiOk(page, 'GET', `/loads?orderId=${order.id}`)).items as any[]).length).toBe(0);
    expect((await api(farm.page, 'GET', `/orders/${order.id}`)).status).toBe(404);
    expect(((await apiOk(page, 'GET', `/orders?q=${order.number}`)).items as any[]).filter((o) => o.id === order.id)).toHaveLength(0);

    // A trilha de auditoria guarda quem, o motivo e o que havia.
    const audit = (await apiOk(page, 'GET', `/audit?action=order.deleted&entityId=${order.id}`)).items as any[];
    expect(audit).toHaveLength(1);
    expect(audit[0].before).toMatchObject({ number: order.number, status: 'IN_PROGRESS' });
    expect(audit[0].after).toMatchObject({ reason: 'Ordem de teste', loads: 1, files: 1 });
    await farm.context.close();
    await buyer.context.close();
  });
});
