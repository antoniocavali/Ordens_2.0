# ADR-008 — Toolchain fixado

**Status**: Aceito · 2026-09-10

## Decisão
- `packageManager: "pnpm@12.3.4"` no `package.json` raiz; `engines.node` e `.nvmrc`/`.node-version` = `24.19.0`.
- `pnpm-lock.yaml` versionado e obrigatório; CI e Dockerfiles usam `--frozen-lockfile`.
- Imagens base Docker com tag de versão exata (`node:24.19.0-alpine…`), atualizadas via Dependabot.
