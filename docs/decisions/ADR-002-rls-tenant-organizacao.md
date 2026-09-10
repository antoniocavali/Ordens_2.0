# ADR-002 — RLS por tenant e organização com transação curta

**Status**: Aceito · 2026-09-10

## Contexto
Fazendas e Compradores coexistem no mesmo tenant e não podem ver dados uns dos outros. Confiar apenas em `WHERE organization_id = …` escrito manualmente é frágil.

## Decisão
- Roles PG `ordens_owner` (migrations) e `ordens_app` (runtime, `NOBYPASSRLS`, não dona).
- `FORCE ROW LEVEL SECURITY` nas tabelas de negócio; política permissiva de tenant + políticas **restritivas** por organização/escopo.
- Contexto `app.tenant_id`, `app.user_id`, `app.membership_id`, `app.scope`, `app.org_ids` definido com `set_config(…, true)` dentro de `db.run(ctx, fn)`, que abre **uma transação curta** por unidade de trabalho — nunca uma transação durante toda a requisição.
- `db.system(fn)` (escopo `SYSTEM`) é o único caminho para operações pré-autenticação e jobs cross-tenant (relay outbox), revisado em code review.
- Testes de isolamento conectam como `ordens_app` e verificam que a role não tem `BYPASSRLS`.

## Alternativas
- Schema por tenant: migrations N×, não resolve isolamento intra-tenant.
- Transação por request (interceptor): segura conexões durante I/O externo (S3, Redis), esgota pool sob carga.

## Consequências
+ Defesa em profundidade contra IDOR/WHERE esquecido.
− Políticas precisam de colunas denormalizadas (`seller_org_id`, `buyer_org_id`) e índices; custo de manter consistência (constraint triggers).
− RLS não protege contra código arbitrário no processo da API (documentado).
