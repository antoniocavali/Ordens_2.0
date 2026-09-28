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
 * Transporte sem cadastro (ADR-010): o agendamento é salvo digitando transportadora, motorista e a
 * composição de veículos, pela tela. Na segunda vez, o CPF já usado traz o resto pelas sugestões.
 */
test.describe('Transporte digitável', () => {
  test.skip(!password, 'Defina E2E_PASSWORD com a senha demo');

  test('Matriz agenda digitando motorista e veículos; a segunda vez vem das sugestões', async ({ page }) => {
    await login(page, 'admin@graoforte.demo');

    const orders = (await apiOk(page, 'GET', '/orders?status=PUBLISHED&status=IN_PROGRESS&pageSize=100')).items as any[];
    const avail = (o: any) => Number(o.quantities.released) - Number(o.quantities.scheduled ?? 0) - Number(o.quantities.loaded ?? 0);
    const order = orders.filter((o) => avail(o) > 20).sort((a, b) => avail(b) - avail(a))[0];
    expect(order, 'ordem publicada com saldo liberado no seed').toBeTruthy();

    const cpf = randomCpf();
    const driverName = `Motorista E2E ${cpf.slice(0, 5)}`;
    const carrier = `Transportadora E2E ${cpf.slice(0, 5)}`;
    const plate = 'QAB1C23';

    // Os cadastros de transporte não existem mais: nenhum menu para eles.
    await page.goto('/agendamentos');
    for (const label of ['Transportadoras', 'Motoristas', 'Veículos', 'Locais']) {
      await expect(page.getByRole('link', { name: label, exact: true })).toHaveCount(0);
    }

    await page.getByRole('button', { name: /Novo agendamento/ }).click();
    const drawer = page.getByRole('dialog', { name: 'Novo agendamento' });
    await drawer.getByRole('combobox').first().click();
    await page.keyboard.type(order.number);
    await page.getByRole('option', { name: new RegExp(order.number) }).first().click();
    await drawer.getByLabel('Data', { exact: false }).first().fill(addDays(2));
    await drawer.getByLabel(/Quantidade prevista/).fill('10');

    await drawer.getByLabel('Transportadora').fill(carrier);
    await drawer.getByLabel('Nome completo').fill(driverName);
    await drawer.getByLabel('CPF').fill(cpf);
    await drawer.getByLabel('CNH', { exact: true }).fill('01234567890');
    await drawer.getByLabel('Validade da CNH').fill(addDays(400));
    await drawer.getByLabel('Placa').fill(plate);
    await drawer.getByLabel('Descrição').fill('Scania R 450');

    // Composição de tamanho variável: a segunda unidade é adicionada na hora.
    await drawer.getByRole('button', { name: 'Adicionar veículo' }).click();
    await drawer.getByLabel('Placa').nth(1).fill('QAB4D56');

    const saveResponse = page.waitForResponse((r) => r.url().includes('/api/appointments') && r.request().method() === 'POST');
    await drawer.getByRole('button', { name: 'Salvar' }).click();
    expect((await saveResponse).status()).toBe(201);
    await expect(drawer).toBeHidden();

    const appointments = (await apiOk(page, 'GET', `/appointments?orderId=${order.id}&pageSize=100`)).items as any[];
    const saved = appointments.find((a) => a.driverCpf === cpf);
    expect(saved, 'agendamento salvo com o CPF digitado').toBeTruthy();
    expect(saved.driverName).toBe(driverName);
    expect(saved.carrierName).toBe(carrier);
    expect(saved.plates).toEqual([plate, 'QAB4D56']);
    expect(saved.vehicles).toHaveLength(2);
    expect(saved.cnhStatus).toBe('OK');

    // Segunda vez: digitar o CPF conhecido preenche o resto a partir das sugestões do grupo.
    await page.reload();
    await page.getByRole('button', { name: /Novo agendamento/ }).click();
    const again = page.getByRole('dialog', { name: 'Novo agendamento' });
    await again.getByLabel('CPF').fill(cpf);
    await again.getByLabel('Nome completo').click();
    await expect(again.getByLabel('Nome completo')).toHaveValue(driverName);
    await expect(again.getByLabel('Transportadora')).toHaveValue(carrier);
    await expect(again.getByLabel('CNH', { exact: true })).toHaveValue('01234567890');
  });
});
