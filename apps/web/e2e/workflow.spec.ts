import { expect, test } from '@playwright/test';
import { api, apiOk, login, loginAs, password } from './helpers';

interface Option {
  id: string;
  label: string;
  meta?: Record<string, string | null>;
}
interface OrderLite {
  id: string;
  number: string;
  updatedAt: string;
  status: string;
  allowedActions: string[];
  workflow: { publishRequestedAt: string | null; publishRequestedBy: string | null; fourEyesRequired: boolean; blockedByFourEyes: boolean } | null;
}

const addDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

/** Fluxo de publicação (Q40): Operador solicita, Gestor publica; dupla checagem impede publicar a própria alteração. */
test.describe('Workflow de publicação', () => {
  test.skip(!password, 'Defina E2E_PASSWORD com a senha demo');

  test('Operador solicita publicação e a dupla checagem exige outra pessoa', async ({ page, browser }) => {
    await login(page, 'admin@graoforte.demo');
    const original = await apiOk<{ publishFourEyes: boolean; publishFourEyesMinT: string | null }>(page, 'GET', '/settings/workflow');

    // Rascunho completo montado pela API, com os primeiros cadastros disponíveis.
    const draftFor = async (p: typeof page) => {
      const seller = (await apiOk<{ items: Option[] }>(p, 'GET', '/lookups/partners?role=SELLER&limit=20')).items.find((s) => Number(s.meta?.farms ?? 0) > 0)!;
      const farm = (await apiOk<{ items: Option[] }>(p, 'GET', `/lookups/farms?sellerId=${seller.id}&limit=5`)).items[0]!;
      const buyer = (await apiOk<{ items: Option[] }>(p, 'GET', '/lookups/partners?role=BUYER&limit=5')).items[0]!;
      const commodity = (await apiOk<{ items: Option[] }>(p, 'GET', '/lookups/commodities')).items[0]!;
      const unit = (await apiOk<Option[]>(p, 'GET', '/lookups/units')).find((u) => u.label === 't')!;
      return apiOk<OrderLite>(p, 'POST', '/orders', {
        sellerPartnerId: seller.id,
        farmId: farm.id,
        buyerPartnerId: buyer.id,
        commodityId: commodity.id,
        unitId: unit.id,
        quantity: '120',
        loadingStartsOn: addDays(2),
        loadingEndsOn: addDays(20),
        destinationName: 'Workflow E2E',
      });
    };

    try {
      // ─── Tela de configuração ───
      await page.goto('/configuracoes/workflow');
      await expect(page.getByRole('heading', { name: 'Workflow' })).toBeVisible();
      const toggle = page.getByRole('switch', { name: 'Exigir dupla checagem na publicação' });
      if ((await toggle.getAttribute('aria-checked')) !== 'true') await toggle.click();
      await page.getByLabel('Quantidade mínima para dupla checagem (t)').fill('');
      await page.getByRole('button', { name: 'Salvar workflow' }).click();
      await expect(page.getByText('Fluxo de publicação salvo')).toBeVisible();
      expect((await apiOk<{ publishFourEyes: boolean }>(page, 'GET', '/settings/workflow')).publishFourEyes).toBe(true);

      // ─── Operador: não publica, solicita ───
      const operator = await loginAs(browser, 'operador@graoforte.demo');
      const draft = await draftFor(operator.page);
      expect(draft.allowedActions).toContain('request_publish');
      expect(draft.allowedActions).not.toContain('publish');
      expect((await api(operator.page, 'POST', `/orders/${draft.id}/publish`, { expectedUpdatedAt: draft.updatedAt })).status).toBe(403);

      await operator.page.goto(`/ordens/${draft.id}`);
      await operator.page.getByRole('button', { name: 'Solicitar publicação' }).click();
      // O texto também aparece no aviso e na notificação: confere pelo banner da página.
      await expect(operator.page.getByRole('status').filter({ hasText: 'Publicação solicitada por' })).toBeVisible();
      await operator.context.close();

      // ─── Gestor (não editou) publica ───
      const manager = await loginAs(browser, 'gestor@graoforte.demo');
      const seen = await apiOk<OrderLite>(manager.page, 'GET', `/orders/${draft.id}`);
      expect(seen.workflow?.publishRequestedBy).toBeTruthy();
      expect(seen.allowedActions).toContain('publish');
      const published = await apiOk<OrderLite>(manager.page, 'POST', `/orders/${draft.id}/publish`, { expectedUpdatedAt: seen.updatedAt });
      expect(published.status).toBe('PUBLISHED');
      await manager.context.close();

      // ─── Dupla checagem: Administrador não publica o rascunho que ele mesmo montou ───
      const own = await draftFor(page);
      expect(own.workflow?.blockedByFourEyes).toBe(true);
      expect(own.allowedActions).toContain('request_publish');
      const blocked = await api(page, 'POST', `/orders/${own.id}/publish`, { expectedUpdatedAt: own.updatedAt });
      expect(blocked.status).toBe(422);
      expect(JSON.stringify(blocked.json)).toContain('FOUR_EYES_REQUIRED');

      // Com mínimo acima da quantidade (120 t), a dupla checagem não se aplica.
      await apiOk(page, 'PUT', '/settings/workflow', { publishFourEyes: true, publishFourEyesMinT: '500' });
      const relaxed = await apiOk<OrderLite>(page, 'GET', `/orders/${own.id}`);
      expect(relaxed.workflow?.fourEyesRequired).toBe(false);
      expect(relaxed.allowedActions).toContain('publish');

      const audit = await apiOk<{ items: unknown[] }>(page, 'GET', '/audit?action=tenant.workflow_updated&pageSize=5');
      expect(audit.items.length).toBeGreaterThan(0);

      // Gestor não tem settings.manage.
      const other = await loginAs(browser, 'gestor@graoforte.demo');
      expect((await api(other.page, 'PUT', '/settings/workflow', { publishFourEyes: false, publishFourEyesMinT: null })).status).toBe(403);
      await other.context.close();
    } finally {
      await apiOk(page, 'PUT', '/settings/workflow', original);
    }
  });
});
