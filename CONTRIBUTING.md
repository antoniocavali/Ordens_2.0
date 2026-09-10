# Contribuindo

## Fluxo

- **GitHub Flow**: `main` protegida; trabalho em `feat/*`, `fix/*`, `chore/*`; merge via Pull Request com checks obrigatórios (CI e Security).
- **Conventional Commits** (validado por commitlint no hook `commit-msg`): `feat(api): ...`, `fix(web): ...`, `docs: ...`.
- Linhas do corpo do commit com até 100 caracteres.

## Antes do PR

```bash
pnpm turbo run typecheck lint test
node scripts/with-host-env.mjs pnpm --filter @ordens/db test:integration
```

Siga a [definição de pronto](docs/definition-of-done.md). Mudanças em migrations, `packages/db/src/context.ts`, autenticação ou guards exigem revisão de segurança (CODEOWNERS).

## Segredos

Nunca commite `.env`, senhas, tokens, chaves ou certificados. O Gitleaks roda em todo PR.
