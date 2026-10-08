import { expect, test } from '@playwright/test';
import { api, apiOk, login, MATRIZ_RECIPIENT_DOC, nfeKey, nfeXml, password, prepareValidatedLoad } from './helpers';

const PDF = Buffer.from('%PDF-1.4\n1 0 obj<< /Type /Catalog >>endobj\ntrailer<< /Root 1 0 R >>\n%%EOF\n');
/**
 * CNPJ da Matriz emitente (a NF-e de venda ao Comprador não é da Fazenda). Tem de ser diferente do de
 * qualquer vendedor: um XML emitido pelo vendedor da ordem é, corretamente, a nota da Fazenda.
 */
const MATRIZ_DOC = MATRIZ_RECIPIENT_DOC;

/** Q47: a carga só é faturada e concluída com PDF e XML da nota emitida pela Matriz. */
test.describe('Faturamento da Matriz na carga', () => {
  test.skip(!password, 'Defina E2E_PASSWORD com a senha demo');

  test('Sem a nota da Matriz o faturamento é recusado; com ela a Matriz fatura, libera para trânsito e a carga conclui', async ({ page }) => {
    test.setTimeout(300_000);
    await login(page, 'admin@graoforte.demo');
    // Carga com a documentação da Fazenda validada: é dali que a Matriz fatura.
    const setup = await prepareValidatedLoad(page);
    const chosen = { id: setup.loadId };
    const getLoad = () => apiOk(page, 'GET', `/loads/${chosen.id}`);
    const move = async (to: string, extra: Record<string, unknown> = {}) => {
      const current = await getLoad();
      return api(page, 'POST', `/loads/${chosen.id}/transition`, { to, expectedUpdatedAt: current.updatedAt, ...extra });
    };

    let load = await getLoad();
    expect(load.status).toBe('FARM_INVOICED');
    expect(load.allowedTransitions).toEqual(['MATRIZ_INVOICED']);
    expect(load.matrizChecklist).toMatchObject({ pdf: 'MISSING', xml: 'MISSING', ready: false });
    // O caminhão não sai antes do faturamento da Matriz, e etapas antigas não existem.
    expect((await move('IN_TRANSIT')).status, 'trânsito só depois do faturamento da Matriz').toBe(422);
    expect((await move('ARRIVED')).status, 'chegada ao destino não existe mais').toBe(422);
    expect((await move('AWAITING_MATRIZ_INVOICE')).status, 'a etapa de encerrar transporte não existe mais').toBe(422);

    // Sem a nota da Matriz: faturar é recusado.
    const refused = await move('MATRIZ_INVOICED');
    expect(refused.status).toBe(422);
    expect(refused.json.error.code).toBe('MATRIZ_INVOICE_MISSING');
    expect(JSON.stringify(refused.json)).toContain('Nota da Matriz');

    // Documentos da Matriz anexados pela tela da carga.
    await page.reload();
    const drawer = page.getByRole('dialog');
    await expect(drawer.getByText('Nota da Matriz para o Comprador')).toBeVisible();
    const fileInput = drawer.locator('input[type="file"]').last();
    await fileInput.setInputFiles({ name: 'nota-matriz.pdf', mimeType: 'application/pdf', buffer: PDF });
    await expect.poll(async () => (await getLoad()).matrizChecklist?.pdf, { timeout: 45_000 }).toBe('OK');

    const key = nfeKey(MATRIZ_DOC);
    await fileInput.setInputFiles({
      name: `NFe${key}.xml`,
      mimeType: 'application/xml',
      buffer: Buffer.from(nfeXml({ key, issuerDoc: MATRIZ_DOC, plate: setup.plate, netKg: Number(load.netKg ?? 10_000) })),
    });
    await expect.poll(async () => (await getLoad()).matrizChecklist?.ready, { timeout: 45_000 }).toBe(true);

    // A nota entra como origem Matriz e libera o faturamento.
    const invoices = (await apiOk(page, 'GET', `/invoices?loadId=${chosen.id}&origin=MATRIZ`)).items as any[];
    expect(invoices.length).toBeGreaterThan(0);

    expect((await move('MATRIZ_INVOICED')).status).toBeLessThan(300);
    load = await getLoad();
    expect(load.status).toBe('MATRIZ_INVOICED');
    expect(load.allowedTransitions).toEqual(['IN_TRANSIT']);
    // Não se conclui direto: o último passo é liberar para trânsito, e é ele que conclui a carga.
    expect((await move('COMPLETED')).status).toBe(422);
    const released = await move('IN_TRANSIT');
    expect(released.status).toBeLessThan(300);
    expect(released.json.status).toBe('COMPLETED');
    load = await getLoad();
    expect(load.status).toBe('COMPLETED');
    expect(load.history.map((h: any) => h.to).slice(-4)).toEqual(['FARM_INVOICED', 'MATRIZ_INVOICED', 'IN_TRANSIT', 'COMPLETED']);
    expect(load.history.map((h: any) => h.to)).not.toContain('AWAITING_MATRIZ_INVOICE');

    const audit = await apiOk(page, 'GET', '/audit?action=load.matriz_invoice_validated&pageSize=5');
    expect((audit.items as any[]).some((e) => e.entityId === chosen.id)).toBe(true);
  });
});
