import { expect, test } from '@playwright/test';
import { api, apiOk, login, nfeKey, nfeXml, password, PDF, prepareLoad } from './helpers';

/**
 * Remoção de anexo na conferência fiscal: arquivo errado sai da conferência com motivo obrigatório,
 * a NF-e gerada a partir dele é cancelada junto, e o registro continua visível no histórico.
 */
test.describe('Remover anexo da conferência fiscal', () => {
  test.skip(!password, 'Defina E2E_PASSWORD com a senha demo');

  test('arquivo errado é removido com motivo, cancela a NF-e e volta a bloquear a validação', async ({ page }) => {
    await login(page, 'admin@graoforte.demo');
    const setup = await prepareLoad(page);
    const getLoad = () => apiOk(page, 'GET', `/loads/${setup.loadId}`);

    await page.goto(`/cargas?abrir=${setup.loadId}`);
    const drawer = page.getByRole('dialog');
    const advance = async (label: string) => {
      const response = page.waitForResponse((r) => r.url().includes(`/loads/${setup.loadId}/transition`) && r.request().method() === 'POST');
      await drawer.getByRole('button', { name: label, exact: true }).click();
      return response;
    };

    expect((await advance('Iniciar carregamento')).ok()).toBe(true);
    await drawer.getByLabel('Peso bruto (kg)').fill('48500');
    await drawer.getByLabel('Tara (kg)').fill('38500');
    expect((await advance('Confirmar carregamento')).ok()).toBe(true);

    // Documentação completa: PDF e XML autorizado da Fazenda.
    const fileInput = drawer.locator('input[type="file"]').first();
    await fileInput.setInputFiles({ name: 'danfe.pdf', mimeType: 'application/pdf', buffer: PDF });
    const key = nfeKey(setup.sellerDoc);
    await fileInput.setInputFiles({ name: `NFe${key}.xml`, mimeType: 'application/xml', buffer: Buffer.from(nfeXml({ key, issuerDoc: setup.sellerDoc, plate: setup.plate, netKg: 10_000 })) });
    await expect.poll(async () => (await getLoad()).fiscalChecklist?.ready, { timeout: 45_000 }).toBe(true);

    // Motivo é obrigatório: a API recusa remoção sem justificativa.
    const uploads = (await apiOk(page, 'GET', `/uploads?entityType=load&entityId=${setup.loadId}`)) as any[];
    const xml = uploads.find((u) => u.kind === 'NFE_XML');
    expect(xml, 'XML anexado à carga').toBeTruthy();
    expect((await api(page, 'POST', `/uploads/${xml.id}/remove`, { reason: '' })).status).toBe(422);

    // Remoção pela tela, arquivo por arquivo.
    await page.reload();
    // As duas seções (Fazenda e Matriz) listam os anexos da carga: age na primeira.
    await drawer.getByRole('button', { name: `Remover ${xml.fileName}` }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Remover arquivo' });
    await expect(dialog.getByRole('button', { name: 'Remover arquivo' })).toBeDisabled();
    await dialog.getByLabel('Motivo').fill('XML de outra carga, enviado por engano');
    const removed = page.waitForResponse((r) => r.url().includes(`/uploads/${xml.id}/remove`) && r.request().method() === 'POST');
    await dialog.getByRole('button', { name: 'Remover arquivo' }).click();
    expect((await removed).status()).toBe(200);
    await expect(dialog).toBeHidden();

    // O registro continua na lista, marcado e com o motivo.
    await expect(drawer.getByText('Removido', { exact: true }).first()).toBeVisible();
    await expect(drawer.getByText(/XML de outra carga, enviado por engano/).first()).toBeVisible();

    // A conferência volta a bloquear e a NF-e gerada pelo arquivo é cancelada.
    await expect.poll(async () => (await getLoad()).fiscalChecklist, { timeout: 30_000 }).toMatchObject({ pdf: 'OK', xml: 'MISSING', ready: false });
    const invoices = (await apiOk(page, 'GET', `/invoices?loadId=${setup.loadId}&pageSize=50`)).items as any[];
    expect(invoices.find((i) => i.accessKey === key)?.status).toBe('CANCELLED');

    const load = await getLoad();
    expect((await api(page, 'POST', `/loads/${setup.loadId}/transition`, { to: 'FARM_INVOICED', expectedUpdatedAt: load.updatedAt })).status).toBe(422);

    // Remover duas vezes o mesmo arquivo não é possível, e a auditoria guarda quem tirou e por quê.
    expect((await api(page, 'POST', `/uploads/${xml.id}/remove`, { reason: 'tentativa repetida' })).status).toBe(422);
    const audit = (await apiOk(page, 'GET', `/audit?entityType=file_upload&entityId=${xml.id}&pageSize=50`)).items as any[];
    const removal = audit.find((e) => e.action === 'upload.removed');
    expect(removal, 'evento de remoção auditado').toBeTruthy();
    expect(JSON.stringify(removal.after)).toContain('XML de outra carga');
  });
});
