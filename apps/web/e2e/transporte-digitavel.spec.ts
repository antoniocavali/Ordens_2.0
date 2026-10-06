import { expect, test } from '@playwright/test';
import { apiOk, login, password } from './helpers';

const addDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

/** CPF válido a partir de uma base aleatória: cada execução usa um motorista inédito. */
function randomCpf(): string {
  const base = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10));
  const digit = (digits: number[]) => {
    const factor = digits.length + 1;
    const sum = digits.reduce((acc, d, i) => acc + d * (factor - i), 0);
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };
  const d1 = digit(base);
  const d2 = digit([...base, d1]);
  return [...base, d1, d2].join('');
}

/**
 * Transporte sem cadastro (ADR-010): transportadora, motorista e composição de veículos são digitados.
 * Quando a ordem não trouxe esses dados, a Fazenda digita na carga que nasceu da chegada do caminhão;
 * na vez seguinte, o CPF já usado traz o resto pelas sugestões.
 */
test.describe('Transporte digitável', () => {
  test.skip(!password, 'Defina E2E_PASSWORD com a senha demo');

  test('transporte é digitado na carga; a segunda vez vem das sugestões', async ({ page }) => {
    await login(page, 'admin@graoforte.demo');

    // Ordem publicada sem transporte informado: as cargas nascem com os campos em branco.
    const sellers = (await apiOk(page, 'GET', '/lookups/partners?role=SELLER&limit=20')).items as any[];
    const seller = sellers.find((x) => /jo[aã]o/i.test(x.label)) ?? sellers[0];
    const farm = ((await apiOk(page, 'GET', `/lookups/farms?sellerId=${seller.id}&limit=5`)).items as any[])[0];
    const buyer = ((await apiOk(page, 'GET', '/lookups/partners?role=BUYER&limit=20')).items as any[])[0];
    const commodity = ((await apiOk(page, 'GET', '/lookups/commodities')).items as any[])[0];
    const unit = ((await apiOk(page, 'GET', '/lookups/units')) as any[]).find((u) => u.label === 't');
    const draft = await apiOk(page, 'POST', '/orders', {
      sellerPartnerId: seller.id, farmId: farm.id, buyerPartnerId: buyer.id, commodityId: commodity.id, unitId: unit.id,
      quantity: '100', loadingStartsOn: addDays(1), loadingEndsOn: addDays(30),
    });
    const order = await apiOk(page, 'POST', `/orders/${draft.id}/publish`, { expectedUpdatedAt: draft.updatedAt });

    const cpf = randomCpf();
    const driverName = `Motorista E2E ${cpf.slice(0, 5)}`;
    const carrier = `Transportadora E2E ${cpf.slice(0, 5)}`;
    const plate = 'QAB1C23';

    // Os cadastros de transporte não existem: nenhum menu para eles.
    const first = await apiOk(page, 'POST', '/loads/arrival', { orderId: order.id });
    await page.goto(`/ordens/${order.id}?carga=${first.id}`);
    for (const label of ['Transportadoras', 'Motoristas', 'Veículos', 'Locais']) {
      await expect(page.getByRole('link', { name: label, exact: true })).toHaveCount(0);
    }

    const drawer = page.getByRole('dialog').first();
    await expect(drawer.getByLabel('Nome completo')).toHaveValue('', { timeout: 15_000 });
    await drawer.getByLabel('Transportadora').fill(carrier);
    await drawer.getByLabel('Nome completo').fill(driverName);
    await drawer.getByLabel('CPF').fill(cpf);
    await drawer.getByLabel('CNH', { exact: true }).fill('01234567890');
    await drawer.getByLabel('Validade da CNH').fill(addDays(400));
    await drawer.getByRole('button', { name: 'Adicionar veículo' }).click();
    await drawer.getByLabel('Placa').first().fill(plate);
    await drawer.getByLabel('Descrição').first().fill('Scania R 450');

    // Composição de tamanho variável: a segunda unidade é adicionada na hora.
    await drawer.getByRole('button', { name: 'Adicionar veículo' }).click();
    await drawer.getByLabel('Placa').nth(1).fill('QAB4D56');

    const saveResponse = page.waitForResponse((r) => r.url().includes(`/api/loads/${first.id}`) && r.request().method() === 'PATCH');
    await drawer.getByRole('button', { name: 'Salvar', exact: true }).click();
    expect((await saveResponse).status()).toBe(200);

    const saved = await apiOk(page, 'GET', `/loads/${first.id}`);
    expect(saved.driverCpf).toBe(cpf);
    expect(saved.driverName).toBe(driverName);
    expect(saved.carrierName).toBe(carrier);
    expect(saved.plates).toEqual([plate, 'QAB4D56']);
    expect(saved.vehicles).toHaveLength(2);
    expect(saved.cnhStatus).toBe('OK');

    // Segundo caminhão: digitar o CPF conhecido preenche o resto a partir das sugestões do grupo.
    const second = await apiOk(page, 'POST', '/loads/arrival', { orderId: order.id });
    await page.goto(`/ordens/${order.id}?carga=${second.id}`);
    const again = page.getByRole('dialog').first();
    await expect(again.getByLabel('Nome completo')).toHaveValue('', { timeout: 15_000 });
    await again.getByLabel('CPF').fill(cpf);
    await again.getByLabel('Nome completo').click();
    await expect(again.getByLabel('Nome completo')).toHaveValue(driverName);
    await expect(again.getByLabel('Transportadora')).toHaveValue(carrier);
    await expect(again.getByLabel('CNH', { exact: true })).toHaveValue('01234567890');
  });
});
