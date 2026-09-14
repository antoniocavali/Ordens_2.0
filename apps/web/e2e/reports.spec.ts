import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { api, apiOk, login, loginAs, password } from './helpers';

/** Relatórios: prévia, exportação CSV auditada e acesso restrito a report.export. */
test.describe('Relatórios', () => {
  test.skip(!password, 'Defina E2E_PASSWORD com a senha demo');

  test('Administrador confere a prévia e exporta CSV auditado', async ({ page, browser }) => {
    await login(page, 'admin@graoforte.demo');
    await page.goto('/gestao/relatorios');
    await expect(page.getByRole('heading', { name: 'Relatórios' })).toBeVisible();

    await page.getByRole('radio', { name: /^Cargas / }).click();
    await page.getByRole('button', { name: '90 dias' }).click();
    const table = page.getByRole('table', { name: 'Cargas' });
    await expect(table.getByRole('columnheader', { name: 'Transportadora' })).toBeVisible();

    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Exportar CSV' }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^relatorio-loads-\d{4}-\d{2}-\d{2}-a-\d{4}-\d{2}-\d{2}\.csv$/);
    const csv = await readFile((await download.path())!, 'utf8');
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.split('\r\n')[0]).toContain('Carga;Ordem;Status');
    await expect(page.getByText('Relatório exportado')).toBeVisible();

    const audit = await apiOk<{ items: { action: string; after: { kind: string } }[] }>(page, 'GET', '/audit?action=report.exported&pageSize=10');
    expect(audit.items.some((e) => e.after.kind === 'loads')).toBe(true);

    // Período inválido é recusado com mensagem por campo.
    const invalid = await api(page, 'GET', '/reports/orders?from=2025-01-01&to=2026-06-30');
    expect(invalid.status).toBe(422);

    // Sem report.export: 403 e sem item no menu.
    const operator = await loginAs(browser, 'operador@graoforte.demo');
    expect((await api(operator.page, 'GET', '/reports/orders')).status).toBe(403);
    expect((await api(operator.page, 'GET', '/reports/orders/export')).status).toBe(403);
    await expect(operator.page.getByRole('link', { name: 'Relatórios' })).toHaveCount(0);
    await operator.context.close();
  });
});
