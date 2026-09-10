import base from '@ordens/config/eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default [
  ...base,
  {
    ignores: ['.next/**', 'next-env.d.ts', 'e2e/**', 'scripts/**', 'playwright.config.ts'],
  },
  {
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'no-console': 'off',
    },
  },
];
