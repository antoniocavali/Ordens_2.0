import base from '@ordens/config/eslint';

export default [
  ...base,
  {
    rules: {
      // NestJS usa emitDecoratorMetadata: classes injetadas precisam de import de VALOR.
      // O autofix desta regra trocaria por `import type` e quebraria a injeção de dependência.
      '@typescript-eslint/consistent-type-imports': 'off',
    },
  },
];
