import { defineConfig } from 'vitest/config';

// Testes unitários do web. Os E2E (e2e/) rodam com Playwright, não com Vitest.
export default defineConfig({
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    exclude: ['e2e/**', 'node_modules/**', '.next/**'],
    passWithNoTests: true,
  },
});
