import { expect, test, type Page } from '@playwright/test';
import { api, apiOk, loginAs, login, nfeKey, nfeXml, password } from './helpers';

/**
 * Logística + fiscal: agendamento convertido em carga → avanço pelo drawer → NF-e obrigatória →
 * upload direto do XML → validação pelo worker → faturamento e pesagem. Isolamento entre compradores.
 */
interface LoadSetup {
  loadId: string;
  loadNumber: string;
  orderId: string;
  buyerName: string;
  sellerDoc: string;
  plate: string;
}

async function prepareLoad(page: Page): Promise<LoadSetup> {
  const today = new Date().toISOString().slice(0, 10);
  const orders = (await apiOk(page, 'GET', '/orders?status=PUBLISHED&status=IN_PROGRESS&pageSize=100')).items as any[];
  const avail = (o: any) => Number(o.quantities.released) - Number(o.quantities.scheduled ?? 0) - Number(o.quantities.loaded ?? 0);
  const order = orders.filter((o) => o.farm && o.seller && avail(o) > 20).sort((a, b) => avail(b) - avail(a))[0];
  expect(order, 'ordem publicada com saldo liberado no seed').toBeTruthy();

  const detail = await apiOk(page, 'GET', `/orders/${order.id}`);
  const seller = await apiOk(page, 'GET', `/partners/${detail.seller.id}`);
  const drivers = ((await apiOk(page, 'GET', '/lookups/drivers')).items as any[]).filter((d) => d.meta.expired === 'false' && d.meta.carrierId);
  const tractors = (await apiOk(page, 'GET', '/lookups/vehicles?kind=tractor')).items as any[];
  const driver = drivers.find((d) => tractors.some((t) => t.meta.carrierId === d.meta.carrierId));
  const tractor = tractors.find((t) => t.meta.carrierId === driver?.meta.carrierId);
  expect(driver && tractor, 'motorista e cavalo da mesma transportadora').toBeTruthy();

  const appt = await apiOk(page, 'POST', '/appointments', {
    orderId: order.id,
    scheduledOn: today,
    windowStart: '08:00',
    windowEnd: '10:00',
    expectedQty: '10',
    carrierPartnerId: driver.meta.carrierId,
    driverId: driver.id,
    tractorVehicleId: tractor.id,
  });
  let converted: any;
  for (const to of ['CONFIRMED', 'CHECKED_IN', 'CONVERTED']) converted = await apiOk(page, 'POST', `/appointments/${appt.id}/transition`, { to });
  const load = await apiOk(page, 'GET', `/loads/${converted.loadId}`);

  return {
    loadId: load.id,
    loadNumber: load.number,
    orderId: order.id,
    buyerName: detail.buyer?.name ?? '',
    sellerDoc: String(seller.document ?? '').replace(/\D/g, ''),
    plate: load.plates[0],
  };
}

test.describe('Logística e fiscal', () => {
  test.skip(!password, 'Defina E2E_PASSWORD com a senha demo');

  test('carga avança pelo drawer com NF-e validada pelo worker', async ({ page, browser }) => {
    await login(page, 'admin@graoforte.demo');
    const setup = await prepareLoad(page);

    await page.goto(`/cargas?abrir=${setup.loadId}`);
    const drawer = page.getByRole('dialog');
    await expect(drawer.getByText(setup.loadNumber).first()).toBeVisible();

    const advance = async (label: string) => {
      const response = page.waitForResponse((r) => r.url().includes(`/loads/${setup.loadId}/transition`) && r.request().method() === 'POST');
      await drawer.getByRole('button', { name: label, exact: true }).click();
      return response;
    };

    for (const label of ['Confirmada', 'Aguardando carregamento', 'Em carregamento', 'Aguardando faturamento']) {
      expect((await advance(label)).ok(), `transição para ${label}`).toBe(true);
      await expect(drawer.getByRole('button', { name: label, exact: true })).toHaveCount(0);
    }

    // Faturar sem NF-e é bloqueado pela API.
    const blocked = await advance('Faturada pela Fazenda');
    expect(blocked.status()).toBe(422);
    expect((await blocked.json()).error.code).toBe('INVOICE_REQUIRED');

    // XML inválido → Rejeitada; XML autorizado da Fazenda → Válida (upload direto no storage + worker).
    const fileInput = drawer.locator('input[type="file"]');
    await fileInput.setInputFiles({ name: 'pedido.xml', mimeType: 'application/xml', buffer: Buffer.from('<?xml version="1.0"?><pedido><id>1</id></pedido>') });
    await expect(drawer.getByText('Rejeitada').first()).toBeVisible({ timeout: 45_000 });

    const key = nfeKey(setup.sellerDoc);
    await fileInput.setInputFiles({ name: `NFe${key}.xml`, mimeType: 'application/xml', buffer: Buffer.from(nfeXml({ key, issuerDoc: setup.sellerDoc, plate: setup.plate, netKg: 10_000 })) });
    await expect(drawer.getByText('Válida').first()).toBeVisible({ timeout: 45_000 });

    expect((await advance('Faturada pela Fazenda')).ok()).toBe(true);
    await expect(drawer.getByRole('button', { name: 'Carregada', exact: true })).toBeVisible();

    // Pesagem é salva junto com a transição.
    await drawer.getByLabel('Peso bruto (kg)').fill('48500');
    await drawer.getByLabel('Tara (kg)').fill('38500');
    await drawer.getByRole('button', { name: 'Carregada', exact: true }).click();
    await expect(drawer.getByRole('button', { name: 'Em trânsito', exact: true })).toBeVisible();

    const final = await apiOk(page, 'GET', `/loads/${setup.loadId}`);
    expect(final.status).toBe('LOADED');
    expect(Number(final.netKg)).toBe(10_000);
    expect(final.history.map((h: any) => h.to)).toEqual(expect.arrayContaining(['AWAITING_FARM_INVOICE', 'FARM_INVOICED', 'LOADED']));

    // Comprador da ordem vê a carga e só a NF-e válida; o outro comprador não vê nada.
    const buyerEmail = /nutri/i.test(setup.buyerName) ? 'comprador.nutri@graoforte.demo' : 'comprador.abc@graoforte.demo';
    const otherEmail = buyerEmail.includes('nutri') ? 'comprador.abc@graoforte.demo' : 'comprador.nutri@graoforte.demo';

    const buyer = await loginAs(browser, buyerEmail);
    const invoices = (await apiOk(buyer.page, 'GET', `/invoices?loadId=${setup.loadId}`)).items as any[];
    expect(invoices.map((i) => i.status)).toEqual(['VALID']);
    await buyer.page.goto(`/cargas?abrir=${setup.loadId}`);
    await expect(buyer.page.getByRole('dialog').getByText('Válida').first()).toBeVisible();
    await expect(buyer.page.getByRole('dialog').getByText('Rejeitada')).toHaveCount(0);
    await buyer.context.close();

    const other = await loginAs(browser, otherEmail);
    expect((await api(other.page, 'GET', `/loads/${setup.loadId}`)).status).toBe(404);
    expect(((await apiOk(other.page, 'GET', `/invoices?loadId=${setup.loadId}`)).items as any[]).length).toBe(0);
    await other.context.close();
  });
});
