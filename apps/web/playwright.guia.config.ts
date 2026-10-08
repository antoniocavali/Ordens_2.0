import { defineConfig, devices } from '@playwright/test';

/**
 * Capturas de tela usadas em /apresentacao e /guia (public/guia). Não faz parte da suíte de testes:
 * rode à mão, contra o ambiente local de demonstração, quando as telas mudarem.
 *
 *   E2E_PASSWORD=... WEB_URL=http://localhost:3020 npx playwright test --config playwright.guia.config.ts
 */
export default defineConfig({
  testDir: './scripts/guia',
  timeout: 900_000,
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: process.env.WEB_URL ?? 'http://localhost:3020',
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    colorScheme: 'light',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } }],
});
