import { expect, test } from '@playwright/test';
import { api, apiOk, loginAs, login, nfeKey, nfeXml, password, PDF, prepareLoad } from './helpers';

/**
 * Logística + fiscal (Q41): veículo na fazenda → carga → carregamento → pesagem obrigatória → documentação fiscal
 * (PDF + XML validado pelo worker) → transporte. XML rejeitado ou upload pendente bloqueiam. Isolamento entre compradores.
 */

test.describe('Logística e fiscal', () => {
  test.skip(!password, 'Defina E2E_PASSWORD com a senha demo');

  test('carga só segue para transporte com pesagem, PDF e XML válidos; cada parte vê só a própria nota', async ({ page, browser }) => {
    test.setTimeout(300_000);
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
    const fileInput = drawer.locator('input[type="file"]').first();
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

    // Não há tela geral de cargas: a carga aparece dentro da ordem, na aba Cargas, filtrável por etapa.
    await page.goto(`/ordens/${setup.orderId}`);
    await page.getByRole('tab', { name: 'Cargas', exact: true }).click();
    await page.getByRole('tab', { name: /Transporte/ }).click();
    await expect(page.getByRole('row', { name: new RegExp(setup.loadNumber) })).toBeVisible();
    const dashboard = await apiOk(page, 'GET', '/dashboard');
    expect((dashboard.attention as any[]).find((a) => a.key === 'awaiting_invoice')?.href).toBe('/ordens?status=IN_PROGRESS');

    // Auditoria e timeline da ordem registram anexos e validação.
    const timeline = (await apiOk(page, 'GET', `/orders/${setup.orderId}/timeline`)) as any[];
    const actions = timeline.map((e) => e.action);
    expect(actions).toEqual(expect.arrayContaining(['order.load_document_attached', 'order.invoice_attached', 'order.load_documents_validated', 'order.load_status']));

    // ─── Quem vê o quê (decisão de 06/10/2026) ───
    // A nota da Fazenda é só dela e da Matriz: o Comprador da ordem vê a carga, mas não a nota nem os arquivos.
    const buyerEmail = /nutri/i.test(setup.buyerName) ? 'comprador.nutri@graoforte.demo' : 'comprador.abc@graoforte.demo';
    const otherEmail = buyerEmail.includes('nutri') ? 'comprador.abc@graoforte.demo' : 'comprador.nutri@graoforte.demo';

    const buyer = await loginAs(browser, buyerEmail);
    const buyerInvoices = async () => (await apiOk(buyer.page, 'GET', `/invoices?loadId=${setup.loadId}`)).items as any[];
    const buyerUploads = async () => ((await apiOk(buyer.page, 'GET', `/uploads?entityType=load&entityId=${setup.loadId}`)) as any[]).filter((u) => u.kind === 'PDF' || u.kind === 'NFE_XML');
    expect(await buyerInvoices(), 'Comprador não vê a NF-e da Fazenda').toHaveLength(0);
    expect(await buyerUploads(), 'Comprador não vê o PDF nem o XML da Fazenda').toHaveLength(0);
    expect((await apiOk(buyer.page, 'GET', `/loads/${setup.loadId}`)).fiscalChecklist).toBeNull();
    await buyer.page.goto(`/cargas?abrir=${setup.loadId}`);
    const buyerDrawer = buyer.page.getByRole('dialog').first();
    await expect(buyerDrawer.getByText('Nota da Matriz para o Comprador')).toBeVisible({ timeout: 20_000 });
    await expect(buyerDrawer.getByText('Documentação fiscal da Fazenda')).toHaveCount(0);

    // A Fazenda da ordem vê a própria nota (inclusive o XML rejeitado, para corrigir).
    const farm = await loginAs(browser, /maria/i.test(setup.sellerName) ? 'fazenda.maria@graoforte.demo' : 'fazenda.joao@graoforte.demo');
    const farmInvoices = async () => (await apiOk(farm.page, 'GET', `/invoices?loadId=${setup.loadId}`)).items as any[];
    const farmUploads = async () => ((await apiOk(farm.page, 'GET', `/uploads?entityType=load&entityId=${setup.loadId}`)) as any[]).filter((u) => u.kind === 'PDF' || u.kind === 'NFE_XML');
    const farmInvoicesBefore = await farmInvoices();
    const farmUploadsBefore = (await farmUploads()).map((u) => u.id).sort();
    expect(farmInvoicesBefore.length).toBeGreaterThan(0);
    expect(farmInvoicesBefore.every((i) => i.origin === 'FARM')).toBe(true);
    expect(farmUploadsBefore.length).toBeGreaterThan(0);

    // ─── A Matriz anexa a nota que emite para o Comprador ───
    const matrizDoc = '11222333000181';
    const matrizKey = nfeKey(matrizDoc);
    await page.goto(`/cargas?abrir=${setup.loadId}`);
    const matrizInput = page.getByRole('dialog').first().locator('input[type="file"]').last();
    await matrizInput.setInputFiles({ name: 'nota-matriz.pdf', mimeType: 'application/pdf', buffer: PDF });
    await expect.poll(async () => (await getLoad()).matrizChecklist?.pdf, { timeout: 45_000 }).toBe('OK');
    await matrizInput.setInputFiles({
      name: `NFe${matrizKey}.xml`,
      mimeType: 'application/xml',
      buffer: Buffer.from(nfeXml({ key: matrizKey, issuerDoc: matrizDoc, plate: setup.plate, netKg: 10_000 })),
    });
    await expect.poll(async () => (await getLoad()).matrizChecklist?.ready, { timeout: 45_000 }).toBe(true);

    // O Comprador passa a ver a nota da Matriz — PDF e XML — e só ela.
    await expect.poll(async () => (await buyerInvoices()).map((i) => `${i.origin}:${i.accessKey}`), { timeout: 30_000 }).toEqual([`MATRIZ:${matrizKey}`]);
    expect((await buyerUploads()).map((u) => u.kind).sort()).toEqual(['NFE_XML', 'PDF']);
    await buyer.page.reload();
    await expect(buyer.page.getByRole('dialog').first().getByText('Válida').first()).toBeVisible({ timeout: 20_000 });
    await buyer.context.close();

    // A Fazenda continua vendo só o que é dela: nada da nota da Matriz.
    expect((await farmInvoices()).map((i) => i.id).sort()).toEqual(farmInvoicesBefore.map((i) => i.id).sort());
    expect((await farmUploads()).map((u) => u.id).sort()).toEqual(farmUploadsBefore);
    expect((await apiOk(farm.page, 'GET', `/loads/${setup.loadId}`)).matrizChecklist).toBeNull();
    await farm.page.goto(`/cargas?abrir=${setup.loadId}`);
    const farmDrawer = farm.page.getByRole('dialog').first();
    await expect(farmDrawer.getByText('Documentação fiscal da Fazenda')).toBeVisible({ timeout: 20_000 });
    await expect(farmDrawer.getByText('Nota da Matriz para o Comprador')).toHaveCount(0);
    await farm.context.close();

    // A Matriz vê tudo.
    const all = (await apiOk(page, 'GET', `/invoices?loadId=${setup.loadId}`)).items as any[];
    expect(new Set(all.map((i) => i.origin))).toEqual(new Set(['FARM', 'MATRIZ']));

    const other = await loginAs(browser, otherEmail);
    expect((await api(other.page, 'GET', `/loads/${setup.loadId}`)).status).toBe(404);
    expect(((await apiOk(other.page, 'GET', `/invoices?loadId=${setup.loadId}`)).items as any[]).length).toBe(0);
    await other.context.close();
  });
});
