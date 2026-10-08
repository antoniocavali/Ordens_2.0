import { expect, test, type Page } from '@playwright/test';
import { apiOk, login, loginAs, password, submitLogin } from './helpers';

/** Nenhuma imagem visível da página pode estar quebrada. */
async function expectImagesLoaded(page: Page) {
  await expect
    .poll(() => page.evaluate(() => Array.from(document.images).filter((i) => i.loading !== 'lazy' && (!i.complete || i.naturalWidth === 0)).map((i) => i.src)))
    .toEqual([]);
}

test.describe('Apresentação institucional', () => {
  test('abre sem login, navega pelos capítulos e leva à entrada', async ({ page }) => {
    const response = await page.goto('/apresentacao');
    expect(response?.status()).toBe(200);
    await expect(page).toHaveURL(/\/apresentacao$/);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Do pedido ao caminhão na estrada');
    await expectImagesLoaded(page);

    // Pausa para o teste controlar o avanço.
    const pause = page.getByRole('button', { name: 'Pausar' });
    if (await pause.isVisible()) await pause.click();
    await expect(page.getByRole('button', { name: 'Anterior' })).toBeDisabled();

    // Teclado e botões avançam tela a tela; a lista de telas também é clicável.
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('[aria-current="step"]')).toContainText('Fazenda');
    await page.keyboard.press('ArrowLeft');
    await expect(page.locator('[aria-current="step"]')).toContainText('Matriz');

    const chapters = page.getByRole('navigation', { name: 'Capítulos' }).getByRole('button');
    await chapters.nth(3).click();
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Um clique cria a carga');
    // O que saiu do sistema não aparece na apresentação como recurso.
    await expect(page.getByText(/Nova liberação|Novo agendamento/)).toHaveCount(0);
    await expectImagesLoaded(page);

    await chapters.last().click();
    await expect(page.getByRole('button', { name: 'Próximo' })).toBeDisabled();
    await page.getByRole('link', { name: 'Entrar na plataforma' }).click();
    await expect(page).toHaveURL(/\/login/);
    // E a tela de entrada leva de volta à apresentação.
    await page.getByRole('link', { name: 'Conheça a plataforma' }).click();
    await expect(page).toHaveURL(/\/apresentacao$/);
  });
});

test.describe('Guia de uso', () => {
  test.skip(!password, 'Defina E2E_PASSWORD com a senha demo');

  test('exige login', async ({ page }) => {
    await page.goto('/guia');
    await expect(page).toHaveURL(/\/login/);
  });

  test('abre no perfil de quem está logado e traz o passo a passo de cada tipo de usuário', async ({ page, browser }) => {
    await login(page, 'fazenda.joao@graoforte.demo');
    await page.getByRole('navigation').first().getByRole('link', { name: 'Guia de uso' }).click();
    await expect(page).toHaveURL(/\/guia$/);
    const mine = page.getByRole('link', { name: /Seu perfil/ });
    await expect(mine).toContainText('Administrador Fazenda');
    // Todos os tipos de usuário têm capítulo.
    for (const name of ['Primeiros passos', 'Administrador Matriz', 'Gestor Matriz', 'Operador Matriz', 'Faturamento', 'Atendente', 'Operador Fazenda', 'Comprador']) {
      await expect(page.getByRole('link', { name: new RegExp(`^${name}`) }).first()).toBeVisible();
    }

    await mine.click();
    await expect(page).toHaveURL(/\/guia\/administrador-fazenda$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Administrador Fazenda' })).toBeVisible();
    for (const task of ['Informar a chegada do caminhão', 'Carregar e pesar', 'Anexar a nota e concluir a validação fiscal', 'Administrar os usuários da fazenda']) {
      await expect(page.getByRole('heading', { level: 2, name: task })).toBeVisible();
    }
    // O guia da Fazenda não ensina o que é da Matriz.
    await expect(page.getByRole('heading', { level: 2, name: /Faturar a carga|Excluir/ })).toHaveCount(0);

    // A captura amplia ao clicar.
    const zoomed = page.getByRole('dialog').getByRole('img');
    await expect(async () => {
      if (!(await zoomed.isVisible())) await page.getByRole('button', { name: /^Ampliar:/ }).first().click();
      await expect(zoomed).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 20_000 });
    await page.keyboard.press('Escape');

    // Outro perfil, pelo atalho do topo.
    const buyer = await loginAs(browser, 'comprador.abc@graoforte.demo');
    await buyer.page.getByRole('link', { name: 'Guia de uso' }).first().click();
    await expect(buyer.page.getByRole('link', { name: /Seu perfil/ })).toContainText('Comprador');
    await buyer.page.goto('/guia/comprador');
    await expect(buyer.page.getByRole('heading', { level: 2, name: 'Solicitar uma ordem' })).toBeVisible();
    await buyer.page.goto('/guia/nao-existe');
    await expect(buyer.page.getByText('Capítulo não encontrado')).toBeVisible();
    await buyer.context.close();
  });

  test('no primeiro acesso a pessoa é levada, uma única vez, ao guia do próprio perfil', async ({ page, browser }) => {
    const stamp = Date.now();
    await login(page, 'gestor@graoforte.demo');
    const orgs = (await apiOk(page, 'GET', '/organizations')) as { id: string; kind: string }[];
    const email = `primeiro.acesso.${stamp}@graoforte.demo`;
    const provisional = `Provisoria-${stamp}-abc!`;
    await apiOk(page, 'POST', '/users', { name: 'Bianca Primeiro Acesso', email, organizationId: orgs.find((o) => o.kind === 'BUYER')!.id, roles: ['BUYER_USER'], temporaryPassword: provisional });

    const ctx = await browser.newContext();
    const np = await ctx.newPage();
    await submitLogin(np, email, provisional, /\/login\/nova-senha/);
    const newPassword = `Pessoal-${stamp}-xyz!`;
    await np.getByLabel('Senha provisória').fill(provisional);
    await np.getByLabel('Nova senha', { exact: true }).fill(newPassword);
    await np.getByLabel('Confirmar nova senha').fill(newPassword);
    await np.getByRole('button', { name: 'Salvar nova senha' }).click();

    // Conta liberada: cai no guia do papel dela (Comprador), com as boas-vindas.
    await expect(np).toHaveURL(/\/guia\/comprador\?boas-vindas=1$/);
    await expect(np.getByRole('heading', { level: 1, name: 'Comprador' })).toBeVisible();
    const welcome = np.getByRole('status').filter({ hasText: 'Bem-vindo, Bianca' });
    await expect(welcome).toContainText('guia do seu perfil');
    expect((await apiOk(np, 'GET', '/auth/me')).user.guideSeen).toBe(true);

    // Dali segue para o sistema, e o desvio não se repete — nem recarregando, nem entrando de novo.
    await welcome.getByRole('link', { name: 'Ir para a Visão geral' }).click();
    await expect(np).toHaveURL('/');
    await np.reload();
    await expect(np.getByRole('heading', { name: /Bianca/ })).toBeVisible();
    await expect(np).toHaveURL('/');
    await ctx.close();
    const again = await (await browser.newContext()).newPage();
    await submitLogin(again, email, newPassword, '/');
    await again.waitForTimeout(1500);
    await expect(again).toHaveURL('/');
    await again.context().close();
  });
});
