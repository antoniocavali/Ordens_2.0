import { expect, test } from '@playwright/test';
import { login, password } from './helpers';

/**
 * Navegar entre telas nunca deixa a área de conteúdo vazia: enquanto a próxima tela carrega, o
 * esqueleto ocupa o lugar. Sem isso, uma tela lenta é indistinguível de uma tela quebrada.
 */
test.describe('Navegação entre telas', () => {
  test.skip(!password, 'Defina E2E_PASSWORD com a senha demo');

  test('a área de conteúdo nunca fica vazia durante a navegação', async ({ page }) => {
    await login(page, 'admin@graoforte.demo');
    const nav = page.getByRole('navigation').first();
    await expect(nav.locator('a[href="/atendimento"]')).toBeVisible({ timeout: 20_000 });

    // Segura o conteúdo da próxima rota para alargar a janela em que ela ainda não chegou.
    await page.route(/_rsc=|\/api\/support\//, async (route) => {
      await new Promise((r) => setTimeout(r, 2500));
      return route.continue();
    });

    await nav.locator('a[href="/atendimento/faturamento"]').first().click();
    // Amostra o miolo da tela durante a troca: em cada instante tem de haver esqueleto ou conteúdo.
    const main = page.locator('#conteudo');
    for (let i = 0; i < 30; i++) {
      const vazio = (await main.innerText().catch(() => '')).trim().length < 5 && !(await main.locator('[aria-busy="true"]').count());
      expect(vazio, 'a área de conteúdo ficou vazia durante a navegação').toBe(false);
      await page.waitForTimeout(100);
    }

    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await expect(page.locator('#conteudo h1')).toHaveText('Atendimento · Faturamento', { timeout: 30_000 });
  });

  test('cada tela do menu abre no primeiro clique', async ({ page }) => {
    const titulos: Record<string, string> = {
      '/atendimento': 'Atendimento · Visão geral',
      '/atendimento/faturamento': 'Atendimento · Faturamento',
      '/atendimento/suporte': 'Atendimento · Suporte',
      '/atendimento/equipe': 'Equipe do atendimento',
      '/gestao/auditoria': 'Auditoria',
      '/gestao/usuarios': 'Usuários',
      '/cargas': 'Cargas',
      '/cadastros/fazendas': 'Fazendas',
      '/ordens': 'Ordens de Carregamento',
      '/liberacoes': 'Liberações',
      '/agendamentos': 'Agendamentos',
      '/documentos': 'Central de Documentos',
    };

    await login(page, 'admin@graoforte.demo');
    const nav = page.getByRole('navigation').first();
    await expect(nav.locator('a[href="/atendimento"]')).toBeVisible({ timeout: 20_000 });

    for (const [href, titulo] of Object.entries(titulos)) {
      await nav.locator(`a[href="${href}"]`).first().click();
      await expect(page.locator('#conteudo h1').first(), `${href} precisa abrir no primeiro clique`).toHaveText(titulo, { timeout: 20_000 });
    }
  });
});
