import { expect, test } from '@playwright/test';
import { apiOk, login, password } from './helpers';

const addDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

/**
 * Agendamento e carga partem da própria ordem, ao lado da liberação, e já vêm com o transporte que o
 * Comprador informou na abertura — sem redigitar motorista e veículos.
 */
test.describe('Agendar e criar carga pela ordem', () => {
  test.skip(!password, 'Defina E2E_PASSWORD com a senha demo');

  test('a ordem oferece agendamento e carga, com o transporte informado pelo Comprador', async ({ page }) => {
    await login(page, 'admin@graoforte.demo');

    // Ordem publicada com saldo e com transporte informado na abertura.
    const orders = (await apiOk(page, 'GET', '/orders?status=PUBLISHED&status=IN_PROGRESS&pageSize=100')).items as any[];
    const avail = (o: any) => Number(o.quantities.released) - Number(o.quantities.scheduled ?? 0) - Number(o.quantities.loaded ?? 0);
    const candidate = orders.filter((o) => avail(o) > 20).sort((a, b) => avail(b) - avail(a))[0];
    expect(candidate, 'ordem publicada com saldo liberado no seed').toBeTruthy();

    const transport = {
      carrierName: 'Transportadora da Ordem',
      driverName: 'Motorista da Ordem',
      driverCpf: '86288366757',
      vehicles: [{ plate: 'ORD1A23', type: 'TRUCK_TRACTOR' }],
    };
    const detail = await apiOk(page, 'GET', `/orders/${candidate.id}`);
    await apiOk(page, 'PATCH', `/orders/${candidate.id}`, {
      expectedVersion: detail.version,
      expectedUpdatedAt: detail.updatedAt,
      data: { ...transport },
    });

    await page.goto(`/ordens/${candidate.id}`);
    const header = page.getByRole('button', { name: 'Novo agendamento' });
    await expect(header, 'botão de agendamento ao lado da liberação').toBeVisible();
    await expect(page.getByRole('button', { name: 'Nova carga' })).toBeVisible();

    // Agendamento abre já preenchido com o transporte da ordem.
    await header.click();
    const drawer = page.getByRole('dialog', { name: 'Novo agendamento' });
    await expect(drawer.getByLabel('Nome completo')).toHaveValue('Motorista da Ordem', { timeout: 15_000 });
    await expect(drawer.getByLabel('Transportadora')).toHaveValue('Transportadora da Ordem');
    await expect(drawer.getByLabel('Placa').first()).toHaveValue('ORD1A23');
    await page.keyboard.press('Escape');

    // Carga criada direto da ordem, também com o transporte dela.
    await page.getByRole('button', { name: 'Nova carga' }).click();
    const loadDrawer = page.getByRole('dialog', { name: /Nova carga/ });
    await expect(loadDrawer.getByLabel('Nome completo')).toHaveValue('Motorista da Ordem', { timeout: 15_000 });
    await loadDrawer.getByLabel(/Quantidade prevista/).fill('10');
    await loadDrawer.getByLabel('Data de carregamento').fill(addDays(1));
    const created = page.waitForResponse((r) => r.url().includes('/api/loads') && r.request().method() === 'POST');
    await loadDrawer.getByRole('button', { name: 'Criar carga' }).click();
    expect((await created).status()).toBe(201);

    const loads = (await apiOk(page, 'GET', `/loads?orderId=${candidate.id}&pageSize=50`)).items as any[];
    const load = loads.find((l) => l.driverCpf === transport.driverCpf);
    expect(load, 'carga criada a partir da ordem').toBeTruthy();
    expect(load.status).toBe('SCHEDULED');
    expect(load.carrierName).toBe('Transportadora da Ordem');
    expect(load.plates).toEqual(['ORD1A23']);
  });
});
