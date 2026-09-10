# Sessões

## Autoridade

- **PostgreSQL (`sessions`) é a fonte de verdade.**
- **Redis** é cache (`sess:{tokenHash}` → snapshot, TTL curto de 60 s) e mecanismo de revogação rápida (`user-secver:{userId}` → versão atual).
- Cache miss, divergência de versão ou Redis indisponível → revalida no PostgreSQL. Redis indisponível **não** autentica ninguém sozinho.

## Token

- 32 bytes aleatórios (`crypto.randomBytes`), enviados no cookie `__Host-ordens_sid` (produção) / `ordens_sid` (dev http).
- Armazenado apenas como `sha256(token)` em `sessions.token_hash`.
- Cookie `HttpOnly`, `Secure` (prod), `SameSite=Lax`, `Path=/`.
- Expiração ociosa 12 h, absoluta 7 dias (configuráveis). `last_seen_at` atualizado no máximo a cada 5 min.

## security_version

`users.security_version` (int) é copiado para `sessions.security_version` na criação. A sessão só é válida se `sessions.security_version = users.security_version`.

Incrementado em: troca/redefinição de senha, logout de todos os dispositivos, desativação de 2FA, marcação de conta comprometida, desativação do usuário.

Ao incrementar: `UPDATE users` + `UPDATE sessions SET revoked_at` na mesma transação + `SET user-secver:{userId}` no Redis + `DEL` dos caches conhecidos. Mesmo que o Redis falhe, a próxima revalidação no PG rejeita.

## Estágios

| stage | Permite |
|---|---|
| `PENDING_2FA` | apenas `POST /auth/2fa/verify`, `POST /auth/logout` |
| `PENDING_2FA_SETUP` | apenas endpoints de setup do 2FA |
| `ACTIVE` | tudo conforme permissões |

## Session fixation

O token é **rotacionado** (nova linha, antiga revogada) no login, após verificação do 2FA e na troca de membership ativa com elevação de escopo.

## CSRF

- Cookie `ordens_csrf` (não HttpOnly) com token aleatório; requisições mutantes enviam `X-CSRF-Token` igual (double-submit) e o token é vinculado ao hash da sessão via HMAC.
- Checagem de `Origin`/`Sec-Fetch-Site` para métodos mutantes.

## Lockout progressivo

Chaves Redis por `email` e por `ip`. Após 5 falhas: espera 30 s; dobrando até 15 min. `users.failed_login_count`/`locked_until` persistem no PG para auditoria. Resposta sempre genérica. Todos os eventos em `login_attempts` + `audit_events`.

## Endpoints

`POST /auth/login` · `POST /auth/logout` · `POST /auth/logout-all` · `GET /auth/me` · `GET /auth/sessions` · `DELETE /auth/sessions/:id` · `GET /auth/login-history` · `POST /auth/password/forgot` · `POST /auth/password/reset` · `POST /auth/password/change` · `POST /auth/context` (troca de membership ativa)
