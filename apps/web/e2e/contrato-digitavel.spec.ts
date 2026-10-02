import { expect, test } from '@playwright/test';
import { api, apiOk, login, loginAs, password } from './helpers';

const emDias = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);

/**
 * Contrato não tem cadastro: é um número que o Faturamento digita ao definir a fazenda. Fica na
 * ordem, aparece na lista e vira sugestão para as próximas — sem bloquear nada por saldo.
 */
test.describe('Contrato digitável', () => {
  test.skip(!password, 'Defina E2E_PASSWORD com a senha demo');

  test('Faturamento digita o contrato ao definir a fazenda e ele acompanha a ordem', async ({ page, browser }) => {
    // Comprador abre a solicitação: ele não informa contrato em momento nenhum.
    await login(page, 'comprador.abc@graoforte.demo');
    const commodity = ((await apiOk(page, 'GET', '/lookups/commodities')).items as { id: string }[])[0]!;
    const units = (await apiOk(page, 'GET', '/lookups/units')) as { id: string; label: string }[];
    const unit = units.find((u) => u.label === 't') ?? units[0]!;
    const draft = await apiOk(page, 'POST', '/orders/buyer', {
      commodityId: commodity.id,
      quantity: '100',
      unitId: unit.id,
      destinationName: `Armazém E2E ${Date.now()}`,
      destinationCity: 'Castro',
      destinationState: 'PR',
      loadingStartsOn: emDias(1),
      loadingEndsOn: emDias(25),
      freightMode: 'FOB',
    });
    const sent = await apiOk(page, 'POST', `/orders/${draft.id}/submit`, { expectedUpdatedAt: draft.updatedAt });
    expect(sent.status).toBe('PENDING_BILLING');
    // A solicitação do Comprador chega sem contrato.
    expect(sent.contractNumber).toBeNull();

    // ─── Faturamento, pela própria tela ───
    const billing = await loginAs(browser, 'faturamento@graoforte.demo');
    await billing.page.goto(`/ordens/${draft.id}`);
    await billing.page.getByRole('button', { name: /Definir fazenda/ }).click();
    const drawer = billing.page.getByRole('dialog');

    // Vendedor e fazenda continuam sendo escolhidos do cadastro.
    await drawer.getByLabel('Vendedor').click();
    await billing.page.keyboard.type('João');
    await billing.page.getByRole('option', { name: /João da Silva/ }).first().click();
    await drawer.getByLabel('Fazenda responsável').click();
    await billing.page.getByRole('option').first().click();

    // Contrato é digitado, não escolhido.
    const numero = `CT-E2E-${Date.now().toString().slice(-6)}`;
    await drawer.getByLabel('Contrato').fill(numero);

    await drawer.getByRole('button', { name: 'Salvar', exact: true }).click();
    await expect(billing.page.getByRole('status').filter({ hasText: 'Fazenda definida' })).toBeVisible({ timeout: 15_000 });

    // O número ficou na ordem, em maiúsculas, sem cadastro por trás.
    const saved = await apiOk(billing.page, 'GET', `/orders/${draft.id}`);
    expect(saved.contractNumber).toBe(numero.toUpperCase());
    await expect(billing.page.getByText(numero.toUpperCase()).first()).toBeVisible();

    // E vira sugestão para a próxima ordem.
    const sugestoes = (await apiOk(billing.page, 'GET', `/lookups/contract-numbers?q=${numero.slice(0, 9)}`)).items as { label: string }[];
    expect(sugestoes.some((s) => s.label === numero.toUpperCase())).toBe(true);

    // Não existe mais cadastro de contratos.
    expect((await api(billing.page, 'GET', '/contracts')).status).toBe(404);
    await billing.context.close();

    // O Comprador vê o número na própria solicitação.
    const comoComprador = await apiOk(page, 'GET', `/orders/${draft.id}`);
    expect(comoComprador.contractNumber).toBe(numero.toUpperCase());
  });
});
