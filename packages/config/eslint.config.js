import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/** Configuração ESLint compartilhada (flat config). */
export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/.next/**', '**/node_modules/**', '**/generated/**', '**/coverage/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
);
