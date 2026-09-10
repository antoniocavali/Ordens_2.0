import base from '@ordens/config/eslint';

export default [
  ...base,
  {
    ignores: ['.next/**', 'next-env.d.ts', 'e2e/**', 'scripts/**', 'playwright.config.ts'],
  },
  {
    rules: {
      // Componentes React usam funções auxiliares com any implícito controlado pelo TS.
      'no-console': 'off',
    },
  },
];
