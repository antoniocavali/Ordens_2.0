import { expect, test } from '@playwright/test';
import { api, apiOk, login, nfeKey, nfeXml, password } from './helpers';

const PDF = Buffer.from('%PDF-1.4\n1 0 obj<< /Type /Catalog >>endobj\ntrailer<< /Root 1 0 R >>\n%%EOF\n');
/** CNPJ da Matriz emitente (a NF-e de venda ao Comprador não é da Fazenda). */
const MATRIZ_DOC = '11222333000181';

/** Q47: a carga só é faturada e concluída com PDF e XML da nota emitida pela Matriz. */
test.describe('Faturamento da Matriz na carga', () => {
  test.skip(!password, 'Defina E2E_PASSWORD com a senha demo');

  test('Sem a nota da Matriz o faturamento é recusado; com PDF e XML válidos a carga conclui', async ({ page }) => {
    await login(page, 'admin@graoforte.demo');
    const loads = (await apiOk(page, 'GET', '/loads?status=IN_TRANSIT&pageSize=50')).items as any[];
    const chosen = loads.find((l) => !l.order.requiresReceipt) ?? loads[0];
    expect(chosen, 'carga em trânsito no seed').toBeTruthy();
    const getLoad = () => apiOk(page, 'GET', `/loads/${chosen.id}`);

    // Trânsito → chegada → recebimento (quantidade obrigatória) → conferência → faturamento.
    const move = async (to: string, extra: Record<string, unknown> = {}) => {
      const current = await getLoad();
      return api(page, 'POST', `/loads/${chosen.id}/transition`, { to, expectedUpdatedAt: current.updatedAt, ...extra });
    };
    if (chosen.order.requiresReceipt) {
      expect((await move('ARRIVED')).status).toBeLessThan(300);
      expect((await move('RECEIVED', { receivedQty: '10' })).status).toBeLessThan(300);
      expect((await move('CHECKED')).status).toBeLessThan(300);
    }
    // Ordem que dispensa o recebimento vai do trânsito direto ao faturamento (Q42).
    expect((await move('AWAITING_MATRIZ_INVOICE')).status).toBeLessThan(300);

    let load = await getLoad();
    expect(load.status).toBe('AWAITING_MATRIZ_INVOICE');
    expect(load.matrizChecklist).toMatchObject({ pdf: 'MISSING', xml: 'MISSING', ready: false });

    // Sem a nota da Matriz: faturar e concluir são recusados.
    const refused = await move('MATRIZ_INVOICED');
    expect(refused.status).toBe(422);
    expect(refused.json.error.code).toBe('MATRIZ_INVOICE_MISSING');
    expect(JSON.stringify(refused.json)).toContain('Nota da Matriz');

    // Documentos da Matriz anexados pela tela da carga.
    await page.goto(`/cargas?abrir=${chosen.id}`);
    const drawer = page.getByRole('dialog');
    await expect(drawer.getByText('Nota da Matriz para o Comprador')).toBeVisible();
    const fileInput = drawer.locator('input[type="file"]').last();
    await fileInput.setInputFiles({ name: 'nota-matriz.pdf', mimeType: 'application/pdf', buffer: PDF });
    await expect.poll(async () => (await getLoad()).matrizChecklist?.pdf, { timeout: 45_000 }).toBe('OK');

    const key = nfeKey(MATRIZ_DOC);
    await fileInput.setInputFiles({
      name: `NFe${key}.xml`,
      mimeType: 'application/xml',
      buffer: Buffer.from(nfeXml({ key, issuerDoc: MATRIZ_DOC, plate: chosen.plates[0] ?? 'ABC1D23', netKg: Number(load.netKg ?? 10_000) })),
    });
    await expect.poll(async () => (await getLoad()).matrizChecklist?.ready, { timeout: 45_000 }).toBe(true);

    // A nota entra como origem Matriz e libera faturamento e conclusão.
    const invoices = (await apiOk(page, 'GET', `/invoices?loadId=${chosen.id}&origin=MATRIZ`)).items as any[];
    expect(invoices.length).toBeGreaterThan(0);

    expect((await move('MATRIZ_INVOICED')).status).toBeLessThan(300);
    expect((await move('COMPLETED')).status).toBeLessThan(300);
    load = await getLoad();
    expect(load.status).toBe('COMPLETED');
    expect(load.history.map((h: any) => h.to)).toEqual(expect.arrayContaining(['AWAITING_MATRIZ_INVOICE', 'MATRIZ_INVOICED', 'COMPLETED']));

    const audit = await apiOk(page, 'GET', '/audit?action=load.matriz_invoice_validated&pageSize=5');
    expect((audit.items as any[]).some((e) => e.entityId === chosen.id)).toBe(true);
  });
});
