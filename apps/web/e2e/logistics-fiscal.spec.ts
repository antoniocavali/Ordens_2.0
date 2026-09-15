import { expect, test, type Page } from '@playwright/test';
import { api, apiOk, loginAs, login, nfeKey, nfeXml, password } from './helpers';

/**
 * Logística + fiscal (Q41): veículo na fazenda → carga → carregamento → pesagem obrigatória → documentação fiscal
 * (PDF + XML validado pelo worker) → transporte. XML rejeitado ou upload pendente bloqueiam. Isolamento entre compradores.
 */
interface LoadSetup {
  loadId: string;
  loadNumber: string;
  orderId: string;
  buyerName: string;
  sellerDoc: string;
  plate: string;
}

const PDF = Buffer.from('%PDF-1.4\n1 0 obj<< /Type /Catalog >>endobj\ntrailer<< /Root 1 0 R >>\n%%EOF\n');

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
  await apiOk(page, 'POST', `/appointments/${appt.id}/transition`, { to: 'CONFIRMED' });
  // Sem registrar a chegada do veículo, não há carga.
  expect((await api(page, 'POST', '/loads', { orderId: order.id, appointmentId: appt.id, expectedQty: '10' })).status).toBe(422);
  await apiOk(page, 'POST', `/appointments/${appt.id}/transition`, { to: 'CHECKED_IN' });
  const converted = await apiOk(page, 'POST', `/appointments/${appt.id}/transition`, { to: 'CONVERTED' });
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

  test('carga só segue para transporte com pesagem, PDF e XML válidos da mesma carga', async ({ page, browser }) => {
    await login(page, 'admin@graoforte.demo');
    const setup = await prepareLoad(page);
    const getLoad = () => apiOk(page, 'GET', `/loads/${setup.loadId}`);

    const created = await getLoad();
    expect(created.status).toBe('AWAITING_LOADING');
    expect(created.history.map((h: any) => h.to)).toEqual(['AWAITING_LOADING']);

    await page.goto(`/cargas?abrir=${setup.loadId}`);
    const drawer = page.getByRole('dialog');
    await expect(drawer.getByText(setup.loadNumber).first()).toBeVisible();

    const advance = async (label: string) => {
      const response = page.waitForResponse((r) => r.url().includes(`/loads/${setup.loadId}/transition`) && r.request().method() === 'POST');
      await drawer.getByRole('button', { name: label, exact: true }).click();
      return response;
    };

    expect((await advance('Iniciar carregamento')).ok()).toBe(true);

    // Confirmar carregamento exige peso bruto e tara.
    const noWeight = await advance('Confirmar carregamento');
    expect(noWeight.status()).toBe(422);
    await drawer.getByLabel('Peso bruto (kg)').fill('48500');
    await drawer.getByLabel('Tara (kg)').fill('38500');
    expect((await advance('Confirmar carregamento')).ok()).toBe(true);
    await expect(drawer.getByRole('button', { name: 'Validar documentação fiscal', exact: true })).toBeVisible();

    let load = await getLoad();
    expect(load.status).toBe('AWAITING_FARM_INVOICE');
    expect(Number(load.netKg)).toBe(10_000);
    expect(load.history.map((h: any) => h.to)).toEqual(['AWAITING_LOADING', 'LOADING', 'LOADED', 'AWAITING_FARM_INVOICE']);
    expect(load.fiscalChecklist).toMatchObject({ weighed: true, pdf: 'MISSING', xml: 'MISSING', ready: false });

    // Sem documentos: validação bloqueada e transporte direto não existe nesta etapa.
    const blocked = await advance('Validar documentação fiscal');
    expect(blocked.status()).toBe(422);
    expect((await blocked.json()).error.code).toBe('FISCAL_DOCUMENTS_REQUIRED');
    expect((await api(page, 'POST', `/loads/${setup.loadId}/transition`, { to: 'IN_TRANSIT', expectedUpdatedAt: load.updatedAt })).status).toBe(422);

    // PDF disponível + XML rejeitado ainda bloqueia.
    const fileInput = drawer.locator('input[type="file"]');
    await fileInput.setInputFiles({ name: 'danfe.pdf', mimeType: 'application/pdf', buffer: PDF });
    await fileInput.setInputFiles({ name: 'pedido.xml', mimeType: 'application/xml', buffer: Buffer.from('<?xml version="1.0"?><pedido><id>1</id></pedido>') });
    await expect(drawer.getByText('Rejeitada').first()).toBeVisible({ timeout: 45_000 });
    await expect.poll(async () => (await getLoad()).fiscalChecklist, { timeout: 45_000 }).toMatchObject({ pdf: 'OK', xml: 'REJECTED', ready: false });
    load = await getLoad();
    const rejected = await api(page, 'POST', `/loads/${setup.loadId}/transition`, { to: 'FARM_INVOICED', expectedUpdatedAt: load.updatedAt });
    expect(rejected.status).toBe(422);
    expect(rejected.json.error.code).toBe('FISCAL_DOCUMENTS_REQUIRED');

    // Envio pendente (iniciado e não concluído) também bloqueia até ser concluído ou cancelado.
    const pending = await apiOk(page, 'POST', '/uploads', {
      entityType: 'load',
      entityId: setup.loadId,
      kind: 'PDF',
      fileName: 'segunda-via.pdf',
      mimeType: 'application/pdf',
      sizeBytes: PDF.length,
      idempotencyKey: `e2e-pending-${Date.now()}`,
    });
    expect((await getLoad()).fiscalChecklist).toMatchObject({ pdf: 'PENDING', ready: false });
    await apiOk(page, 'POST', `/uploads/${pending.uploadId}/abort`);

    // XML autorizado da Fazenda → válido → documentação completa.
    const key = nfeKey(setup.sellerDoc);
    await fileInput.setInputFiles({ name: `NFe${key}.xml`, mimeType: 'application/xml', buffer: Buffer.from(nfeXml({ key, issuerDoc: setup.sellerDoc, plate: setup.plate, netKg: 10_000 })) });
    await expect(drawer.getByText('Válida').first()).toBeVisible({ timeout: 45_000 });
    await expect.poll(async () => (await getLoad()).fiscalChecklist?.ready, { timeout: 45_000 }).toBe(true);
    await page.reload();
    await expect(drawer.getByRole('button', { name: 'Validar documentação fiscal', exact: true })).toBeVisible();

    expect((await advance('Validar documentação fiscal')).ok()).toBe(true);
    await expect(drawer.getByRole('button', { name: 'Liberar para transporte', exact: true })).toBeVisible();
    expect((await advance('Liberar para transporte')).ok()).toBe(true);

    const final = await getLoad();
    expect(final.status).toBe('IN_TRANSIT');
    expect(final.history.map((h: any) => h.to)).toEqual(expect.arrayContaining(['FARM_INVOICED', 'IN_TRANSIT']));

    // Auditoria e timeline da ordem registram anexos e validação.
    const timeline = (await apiOk(page, 'GET', `/orders/${setup.orderId}/timeline`)) as any[];
    const actions = timeline.map((e) => e.action);
    expect(actions).toEqual(expect.arrayContaining(['order.load_document_attached', 'order.invoice_attached', 'order.load_documents_validated', 'order.load_status']));

    // Comprador da ordem vê a carga, o PDF compartilhado e só a NF-e válida; o outro comprador não vê nada.
    const buyerEmail = /nutri/i.test(setup.buyerName) ? 'comprador.nutri@graoforte.demo' : 'comprador.abc@graoforte.demo';
    const otherEmail = buyerEmail.includes('nutri') ? 'comprador.abc@graoforte.demo' : 'comprador.nutri@graoforte.demo';

    const buyer = await loginAs(browser, buyerEmail);
    const invoices = (await apiOk(buyer.page, 'GET', `/invoices?loadId=${setup.loadId}`)).items as any[];
    expect(invoices.map((i) => i.status)).toEqual(['VALID']);
    const uploads = (await apiOk(buyer.page, 'GET', `/uploads?entityType=load&entityId=${setup.loadId}`)) as any[];
    expect(uploads.some((u) => u.kind === 'PDF')).toBe(true);
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
