# ADR-005 — Sessões opacas com PostgreSQL como autoridade

**Status**: Aceito · 2026-09-10

## Decisão
- Token opaco aleatório em cookie HttpOnly; apenas `sha256` persistido em `sessions`.
- PostgreSQL é a fonte de verdade; Redis é cache (TTL curto) e revogação rápida.
- `users.security_version` incrementado em troca de senha, logout-all, desativação de 2FA ou comprometimento; sessões com versão anterior são inválidas imediatamente, independentemente de cache.
- Rotação de token no login, após 2FA e em elevação de contexto.

## Alternativas
JWT stateless: revogação imediata exigiria denylist (reintroduz estado) e tokens longos no browser.

## Consequências
+ Logout de todos os dispositivos real e instantâneo; histórico e listagem de sessões.
− Uma leitura (cache ou PG) por requisição.
