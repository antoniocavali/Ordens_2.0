import { expect, test, type Page } from '@playwright/test';
import { api, apiOk, login, loginAs, password } from './helpers';

/** PNG 1x1 válido: serve para o pipeline reconhecer o tipo real por magic bytes. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

/** Abre uma conversa já na fila de Faturamento e devolve o id. */
async function conversationInQueue(page: Page, subject: string): Promise<string> {
  const created = await apiOk(page, 'POST', '/support/conversations', {});
  await apiOk(page, 'POST', `/support/conversations/${created.id}/messages`, { quickReply: 'BILLING' });
  await apiOk(page, 'POST', `/support/conversations/${created.id}/messages`, { body: subject });
  return created.id;
}

/** Sobe a imagem pelo caminho do atendimento (autorizar → PUT assinado → concluir). */
async function sendAttachment(page: Page, conversationId: string, name: string): Promise<string> {
  const init = await apiOk(page, 'POST', `/support/conversations/${conversationId}/attachments`, {
    fileName: name,
    mimeType: 'image/png',
    sizeBytes: PNG.length,
    idempotencyKey: `${conversationId}-${name}-${Date.now()}`,
  });
  const put = await page.request.put(init.url, { data: PNG, headers: { 'content-type': 'image/png' } });
  expect(put.ok(), 'PUT assinado no storage').toBe(true);
  const done = await apiOk(page, 'POST', `/support/conversations/${conversationId}/attachments/${init.uploadId}/complete`, {});
  return done.id;
}

/**
 * Imagem no atendimento: o cliente anexa sem ter permissão de documentos, o atendente enxerga, e nem
 * a conversa de outro cliente nem a nota interna vazam.
 */
test.describe('Imagem no atendimento', () => {
  test.skip(!password, 'Defina E2E_PASSWORD com a senha demo');

  test('cliente anexa, atendente vê; outra conversa e nota interna ficam fora do alcance', async ({ page, browser }) => {
    await login(page, 'comprador.abc@graoforte.demo');

    // Quem abre o atendimento não tem permissão de documentos — e mesmo assim anexa (requisito do fluxo).
    const me = await apiOk(page, 'GET', '/auth/me');
    expect(me.permissions).toContain('support.use');
    expect(me.permissions, 'o fluxo não pode depender de document.upload').not.toContain('document.upload');

    const subject = `Boleto divergente ${Date.now()}`;
    const conversationId = await conversationInQueue(page, subject);
    const uploadId = await sendAttachment(page, conversationId, 'captura.png');

    // A imagem só vira anexo quando vai junto de uma mensagem.
    await apiOk(page, 'POST', `/support/conversations/${conversationId}/messages`, { body: 'Segue a tela do boleto', attachmentIds: [uploadId] });
    const detail = await apiOk(page, 'GET', `/support/conversations/${conversationId}`);
    const withImage = detail.messages.find((m: any) => m.attachments?.length);
    expect(withImage, 'mensagem com a imagem').toBeTruthy();
    expect(withImage.attachments[0].id).toBe(uploadId);
    // Enquanto o worker verifica, não há endereço para abrir.
    await expect.poll(async () => (await apiOk(page, 'GET', `/support/conversations/${conversationId}`)).messages.at(-1)?.attachments?.[0]?.status, { timeout: 45_000 }).toBe('AVAILABLE');
    expect((await apiOk(page, 'GET', `/support/attachments/${uploadId}/download`)).url).toContain('http');

    // A mesma imagem não pode ser reaproveitada em outra mensagem.
    expect((await api(page, 'POST', `/support/conversations/${conversationId}/messages`, { body: 'de novo', attachmentIds: [uploadId] })).status).toBe(409);

    // ─── Pela tela: o chat mostra a imagem e oferece capturar/anexar ───
    await page.goto(`/?atendimento=${conversationId}`);
    const chat = page.getByRole('dialog', { name: 'Atendimento' });
    await expect(chat.getByRole('button', { name: 'captura.png' })).toBeVisible({ timeout: 15_000 });
    await expect(chat.getByRole('button', { name: 'Capturar tela' })).toBeVisible();

    // Anexar pelo seletor de arquivo (alternativa à captura, usada também no celular).
    await chat.locator('input[type="file"]').setInputFiles({ name: 'anexo-tela.png', mimeType: 'image/png', buffer: PNG });
    await expect(chat.getByRole('button', { name: 'Remover anexo-tela.png' })).toBeVisible({ timeout: 15_000 });
    await expect(chat.getByText(/Revise a imagem antes de enviar/)).toBeVisible();
    await chat.getByRole('textbox', { name: 'Mensagem' }).fill('Mais uma tela');
    await chat.getByRole('button', { name: 'Enviar mensagem' }).click();
    await expect(chat.getByRole('button', { name: 'anexo-tela.png' })).toBeVisible({ timeout: 20_000 });

    // ─── Outro cliente não alcança a imagem, nem pela conversa, nem pelo download ───
    const outro = await loginAs(browser, 'fazenda.joao@graoforte.demo');
    expect((await api(outro.page, 'GET', `/support/conversations/${conversationId}`)).status).toBe(404);
    expect((await api(outro.page, 'GET', `/support/attachments/${uploadId}/download`)).status).toBe(404);

    // Nem consegue prender a imagem de outra pessoa numa conversa sua.
    const outraConversa = await conversationInQueue(outro.page, `Outra conversa ${Date.now()}`);
    expect((await api(outro.page, 'POST', `/support/conversations/${outraConversa}/messages`, { body: 'tentando', attachmentIds: [uploadId] })).status).toBe(404);
    await outro.context.close();

    // ─── Atendente de Faturamento vê a imagem do cliente ───
    const agente = await loginAs(browser, 'faturamento@graoforte.demo');
    const agenteDetail = await apiOk(agente.page, 'GET', `/support/conversations/${conversationId}`);
    expect(agenteDetail.messages.some((m: any) => m.attachments?.some((a: any) => a.id === uploadId))).toBe(true);
    expect((await apiOk(agente.page, 'GET', `/support/attachments/${uploadId}/download`)).url).toContain('http');

    // ─── Nota interna com imagem não chega ao cliente ───
    const internoId = await sendAttachment(agente.page, conversationId, 'interno.png');
    await apiOk(agente.page, 'POST', `/support/conversations/${conversationId}/messages`, { body: 'Print do sistema interno', internal: true, attachmentIds: [internoId] });
    await agente.context.close();

    const comoCliente = await apiOk(page, 'GET', `/support/conversations/${conversationId}`);
    expect(JSON.stringify(comoCliente)).not.toContain(internoId);
    expect((await api(page, 'GET', `/support/attachments/${internoId}/download`)).status).toBe(404);
  });
});
