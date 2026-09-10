# ADR-001 — Identidade global e acesso por membership

**Status**: Aceito · 2026-09-10

## Contexto
A mesma pessoa pode atuar em mais de uma empresa/tenant (ex.: consultor, cooperado que também opera outra fazenda). Duplicar usuários duplicaria senha, 2FA e sessões.

## Decisão
- `users` é identidade global (e-mail único, senha, 2FA, sessões, `security_version`).
- `memberships (tenant_id, user_id, organization_id, scope)` concede acesso; `membership_roles` atribui papéis. Permissões derivam dos papéis da **membership ativa**.
- A sessão guarda `active_membership_id`; troca via `POST /auth/context` (auditada, rotaciona token quando muda escopo).

## Consequências
+ Uma credencial por pessoa; 2FA e revogação globais.
+ Autorização sempre contextual (tenant + organização).
− Política de 2FA exigida por tenant precisa ser verificada ao ativar cada membership.
