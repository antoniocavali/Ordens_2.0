import { expect, test } from '@playwright/test';
import { api, apiOk, login, password } from './helpers';

interface OrderLite {
  id: string;
  number: string;
  version: number;
  tolerancePct: string;
  quantities: { total: string; released: string; scheduled: string; loaded: string };
}

/** Liberações: lista geral, cancelamento com motivo (nova versão, auditoria) e bloqueio de cancelamento repetido. */
test.describe('Liberações', () => {
  test.skip(!password, 'Defina E2E_PASSWORD com a senha demo');

  test('Administrador cancela liberação pela tela de Liberações', async ({ page }) => {
    await login(page, 'admin@graoforte.demo');

    // Ordem publicada com saldo liberável para criar uma liberação nova.
    const list = await apiOk<{ items: { id: string }[] }>(page, 'GET', '/orders?status=PUBLISHED&status=IN_PROGRESS&pageSize=50');
    let order: OrderLite | null = null;
    for (const { id } of list.items) {
      const d = await apiOk<OrderLite>(page, 'GET', `/orders/${id}`);
      const max = Number(d.quantities.total) * (1 + Number(d.tolerancePct) / 100);
      if (max - Number(d.quantities.released) >= 1) {
        order = d;
        break;
      }
    }
    expect(order, 'ordem publicada com saldo liberável no seed').not.toBeNull();
    const created = await apiOk<{ version: number; releases: { id: string; sequence: number }[] }>(page, 'POST', `/orders/${order!.id}/releases`, {
      quantity: '1',
      validUntil: null,
      notes: 'E2E liberações',
      expectedVersion: order!.version,
    });
    const release = created.releases.at(-1)!;

    await page.goto('/liberacoes');
    await expect(page.getByRole('heading', { name: 'Liberações' })).toBeVisible();
    await page.getByLabel('Buscar por ordem').fill(order!.number);
    // Nome da linha começa pelo número da ordem: garante a linha certa mesmo antes do filtro aplicar.
    const rowName = new RegExp(`^${order!.number} Liberação ${String(release.sequence).padStart(2, '0')}\\b`);
    const row = page.getByRole('row', { name: rowName });
    await expect(row).toBeVisible();

    await row.getByRole('button', { name: /Cancelar liberação/ }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('button', { name: 'Cancelar liberação' })).toBeDisabled();
    await dialog.getByLabel(/Motivo do cancelamento/).fill('Quantidade lançada em duplicidade');
    await dialog.getByRole('button', { name: 'Cancelar liberação' }).click();
    await expect(page.getByText(/cancelada/i).first()).toBeVisible();
    await expect(dialog).toBeHidden();

    await page.getByRole('tab', { name: 'Canceladas' }).click();
    const cancelledRow = page.getByRole('row', { name: rowName });
    await expect(cancelledRow.getByText('Quantidade lançada em duplicidade')).toBeVisible();

    // Nova versão com o liberado reduzido; cancelar de novo é recusado.
    const after = await apiOk<OrderLite & { releases: { id: string; status: string }[] }>(page, 'GET', `/orders/${order!.id}`);
    expect(after.version).toBe(created.version + 1);
    expect(after.releases.find((r) => r.id === release.id)?.status).toBe('CANCELLED');
    const again = await api(page, 'POST', `/orders/${order!.id}/releases/${release.id}/cancel`, { reason: 'De novo', expectedVersion: after.version });
    expect(again.status).toBe(422);

    // Evento aparece na auditoria.
    const audit = await apiOk<{ items: { action: string }[] }>(page, 'GET', `/audit?entityType=loading_order&entityId=${order!.id}&action=order.release_cancelled`);
    expect(audit.items.length).toBeGreaterThan(0);
  });
});
