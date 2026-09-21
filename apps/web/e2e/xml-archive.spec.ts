import { existsSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { api, apiOk, login, MATRIZ_RECIPIENT_DOC, nfeKey, nfeXml, password, prepareLoad } from './helpers';

/**
 * Cópia do XML da Fazenda em pasta de rede. No CI o destino é um compartilhamento SMB real (Samba,
 * via smbclient); localmente, uma pasta liberada em XML_ARCHIVE_LOCAL_ROOTS.
 */
const TARGET = process.env.E2E_XML_ARCHIVE_PATH ?? 'C:\\PROJETOS\\xml-rede-teste\\e2e';
const USER = process.env.E2E_XML_ARCHIVE_USER ?? null;
const PASS = process.env.E2E_XML_ARCHIVE_PASS;
const isNetwork = TARGET.startsWith('\\\\');
const BAD_TARGET = isNetwork ? '\\\\localhost\\NaoExiste' : 'C:\\Windows\\Temp\\ordens-nao-liberada';

test.describe('Cópia do XML em pasta de rede', () => {
  test.skip(!password, 'Defina E2E_PASSWORD com a senha demo');

  test('configura a pasta, testa a conexão e copia o XML aceito da Fazenda', async ({ page }) => {
    test.setTimeout(180_000);
    await login(page, 'admin@graoforte.demo');

    // Caminho inválido é recusado já na validação.
    const invalid = await api(page, 'PUT', '/settings/xml-archive', { enabled: true, path: 'pasta-relativa', folderTemplate: '' });
    expect(invalid.status).toBe(422);

    // Destino inacessível: o teste mostra o motivo sem expor detalhes técnicos.
    await apiOk(page, 'PUT', '/settings/xml-archive', { enabled: false, path: BAD_TARGET, username: USER, ...(PASS ? { password: PASS } : {}), folderTemplate: '' });
    await page.goto('/configuracoes/parametros');
    await page.getByRole('button', { name: 'Testar conexão' }).click();
    await expect(page.getByText(isNetwork ? 'Compartilhamento não encontrado no servidor.' : /Pasta local não liberada/).first()).toBeVisible({ timeout: 45_000 });

    // Configuração pela tela: troca do endereço, ativação e teste com sucesso.
    const form = page.getByRole('form', { name: 'Pasta de rede' });
    await form.getByLabel('Pasta de destino').fill(TARGET.replace(/\\/g, '/'));
    await page.getByRole('switch', { name: 'Copiar XML da Fazenda para a pasta de rede' }).click();
    // Modelo inválido bloqueia o salvamento; o modelo pronto do SAAM organiza por ano > mês > dia > CNPJ > tipo.
    await form.getByLabel('Modelo das subpastas').fill('{ano}\\{senha}');
    await expect(form.getByText(/Modelo inválido/)).toBeVisible();
    await form.getByRole('button', { name: 'Ano / mês / dia / CNPJ / tipo (padrão SAAM)' }).click();
    await expect(form.getByLabel('Prévia do caminho')).toContainText('\\2026\\09\\01\\10333574000135\\NFE\\');
    await form.getByRole('button', { name: 'Salvar' }).click();
    await expect(page.getByText('Parâmetros salvos')).toBeVisible();
    // O caminho é normalizado com barras invertidas.
    await expect(form.getByLabel('Pasta de destino')).toHaveValue(TARGET);
    await page.getByRole('button', { name: 'Testar conexão' }).click();
    await expect(page.getByText('Gravação e remoção de arquivo de teste concluídas.').first()).toBeVisible({ timeout: 45_000 });

    // A senha nunca volta para a tela.
    const settings = await apiOk(page, 'GET', '/settings/xml-archive');
    expect(settings).toMatchObject({ enabled: true, path: TARGET, hasPassword: Boolean(PASS) });
    expect(JSON.stringify(settings)).not.toContain(PASS ?? '§nada§');

    // XML da Fazenda aceito → cópia na pasta, organizada no padrão SAAM (ano > mês > dia > CNPJ da Matriz destinatária > NFE).
    const setup = await prepareLoad(page);
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

    const key = nfeKey(setup.sellerDoc);
    await drawer.locator('input[type="file"]').first().setInputFiles({
      name: `NFe${key}.xml`,
      mimeType: 'application/xml',
      buffer: Buffer.from(nfeXml({ key, issuerDoc: setup.sellerDoc, plate: setup.plate, netKg: 10_000 })),
    });
    const archived = async () => ((await apiOk(page, 'GET', `/invoices?loadId=${setup.loadId}&origin=FARM`)).items as any[])[0]?.archive;
    await expect.poll(async () => (await archived())?.status, { timeout: 60_000 }).toBe('COPIED');
    const info = await archived();
    const [year, month, day] = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()).split('-');
    expect(info.path).toBe(`${TARGET}\\${year}\\${month}\\${day}\\${MATRIZ_RECIPIENT_DOC}\\NFE\\${key}-nfe.xml`);
    if (!isNetwork) expect(existsSync(info.path)).toBe(true);

    const audit = await apiOk(page, 'GET', '/audit?action=invoice.xml_archived&pageSize=10');
    expect((audit.items as any[]).length).toBeGreaterThan(0);

    // O painel de parâmetros mostra a situação das cópias.
    await page.goto('/configuracoes/parametros');
    await expect(page.getByLabel('Situação das cópias').getByText(/copiados/)).toBeVisible();

    await apiOk(page, 'PUT', '/settings/xml-archive', { enabled: false, path: TARGET, folderTemplate: '' });
  });

  test('só a Matriz com permissão acessa os parâmetros', async ({ page }) => {
    await login(page, 'fazenda.joao@graoforte.demo');
    expect((await api(page, 'GET', '/settings/xml-archive')).status).toBe(403);
    expect((await api(page, 'POST', '/settings/xml-archive/test')).status).toBe(403);
  });
});
