import { expect, test } from '@playwright/test';
import { api, apiOk, login, loginAs, password } from './helpers';

/** Relatórios em segundo plano: pedido → worker gera com o RLS de quem pediu → aviso → download auditado. */
test.describe('Relatórios em segundo plano', () => {
  test.skip(!password, 'Defina E2E_PASSWORD com a senha demo');

  test('pede, recebe o aviso, baixa o arquivo e ninguém mais acessa', async ({ page, browser }) => {
    await login(page, 'admin@graoforte.demo');

    // Pela tela: formato Excel e "Gerar em segundo plano".
    await page.goto('/gestao/relatorios');
    await page.getByRole('radio', { name: /^Cargas / }).click();
    const panel = page.getByRole('radiogroup', { name: 'Formato da exportação em segundo plano' });
    await panel.getByRole('radio', { name: 'Excel' }).click();
    const requested = page.waitForResponse((r) => r.url().includes('/api/reports/loads/jobs') && r.request().method() === 'POST');
    await page.getByRole('button', { name: 'Gerar em segundo plano' }).click();
    const job = await (await requested).json();
    expect(job).toMatchObject({ kind: 'loads', format: 'xlsx', status: 'PENDING' });

    // O worker gera o arquivo; a lista atualiza sozinha até ficar pronto.
    await expect.poll(async () => ((await apiOk(page, 'GET', '/reports/jobs')) as any[]).find((j) => j.id === job.id)?.status, { timeout: 60_000 }).toBe('DONE');
    const exports = page.getByRole('list', { name: 'Exportações recentes' });
    await expect(exports.getByText('Pronto').first()).toBeVisible({ timeout: 15_000 });

    // Aviso no sino.
    await expect
      .poll(async () => ((await apiOk(page, 'GET', '/notifications')).items as any[]).some((n) => n.title.startsWith('Relatório pronto')), { timeout: 30_000 })
      .toBe(true);

    // Download: link temporário do storage com um .xlsx válido (zip começa com "PK").
    const { url } = await apiOk(page, 'GET', `/reports/jobs/${job.id}/download`);
    const file = Buffer.from(await (await fetch(url)).arrayBuffer());
    expect(file.subarray(0, 2).toString()).toBe('PK');
    const audit = await apiOk(page, 'GET', `/audit?action=report.downloaded&pageSize=5`);
    expect((audit.items as any[]).some((e) => e.entityId === job.id)).toBe(true);

    // Outra pessoa não vê nem baixa a exportação.
    const other = await loginAs(browser, 'gestor@graoforte.demo');
    expect(((await apiOk(other.page, 'GET', '/reports/jobs')) as any[]).some((j) => j.id === job.id)).toBe(false);
    expect((await api(other.page, 'GET', `/reports/jobs/${job.id}/download`)).status).toBe(404);
    await other.context.close();

    // Perfil sem o relatório: recusado já no pedido.
    const farm = await loginAs(browser, 'fazenda.joao@graoforte.demo');
    expect((await api(farm.page, 'POST', '/reports/carriers/jobs', { format: 'csv' })).status).toBe(403);
    await farm.context.close();
  });
});
