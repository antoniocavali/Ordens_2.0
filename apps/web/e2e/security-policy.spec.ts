import { expect, test } from '@playwright/test';
import { api, apiOk, login, loginAs, password } from './helpers';

interface Policy {
  require2fa: boolean;
  require2faRoles: string[];
  viewSlaHours: number;
  coverage: { totalMembers: number; with2fa: number; roles: { role: string; total: number }[]; without2fa: { email: string; roles: string[] }[] };
}

/** Política de segurança: exigir 2FA por papel mostra o impacto, salva com auditoria e só o Administrador altera. */
test.describe('Política de segurança', () => {
  test.skip(!password, 'Defina E2E_PASSWORD com a senha demo');

  test('Administrador exige 2FA de um papel e ajusta o prazo de visualização', async ({ page, browser }) => {
    await login(page, 'admin@graoforte.demo');
    const original = await apiOk<Policy>(page, 'GET', '/settings/security');
    expect(original.coverage.totalMembers).toBeGreaterThan(0);
    // Nenhum dado sensível do segredo 2FA vaza na cobertura.
    expect(JSON.stringify(original)).not.toMatch(/secret/i);

    try {
      await page.goto('/configuracoes/seguranca');
      await expect(page.getByRole('heading', { name: 'Segurança' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Salvar política' })).toBeDisabled();

      // Exigir 2FA do Somente leitura Matriz (papel sem uso nos demais testes) mostra o impacto antes de salvar.
      const viewerRow = page.getByRole('checkbox', { name: /Somente leitura Matriz/ });
      if (!(await viewerRow.isChecked())) await viewerRow.check();
      const viewersWithout = original.coverage.without2fa.filter((m) => m.roles.includes('MATRIZ_VIEWER')).length;
      if (viewersWithout && !original.require2faRoles.includes('MATRIZ_VIEWER')) {
        await expect(page.getByText(/configurar 2FA no próximo acesso/)).toBeVisible();
      }

      await page.getByLabel('Prazo de visualização em horas').fill(String(original.viewSlaHours === 36 ? 30 : 36));
      await page.getByRole('button', { name: 'Salvar política' }).click();
      await expect(page.getByText('Política de segurança salva')).toBeVisible();

      const saved = await apiOk<Policy>(page, 'GET', '/settings/security');
      expect(saved.require2faRoles).toContain('MATRIZ_VIEWER');
      expect(saved.viewSlaHours).toBe(original.viewSlaHours === 36 ? 30 : 36);
      const audit = await apiOk<{ items: { action: string }[] }>(page, 'GET', '/audit?action=tenant.security_policy_updated&pageSize=5');
      expect(audit.items.length).toBeGreaterThan(0);

      // Validação do prazo.
      expect((await api(page, 'PUT', '/settings/security', { ...saved, viewSlaHours: 0 })).status).toBe(422);

      // Gestor não tem security.policy.manage.
      const manager = await loginAs(browser, 'gestor@graoforte.demo');
      expect((await api(manager.page, 'GET', '/settings/security')).status).toBe(403);
      expect((await api(manager.page, 'PUT', '/settings/security', { require2fa: true, require2faRoles: [], viewSlaHours: 24 })).status).toBe(403);
      await expect(manager.page.getByRole('link', { name: 'Segurança' })).toHaveCount(0);
      await manager.context.close();
    } finally {
      // Restaura a política para não afetar os demais testes (login de papéis sem 2FA).
      await apiOk(page, 'PUT', '/settings/security', { require2fa: original.require2fa, require2faRoles: original.require2faRoles, viewSlaHours: original.viewSlaHours });
    }
  });
});
