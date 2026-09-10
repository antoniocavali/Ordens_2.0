# Auditoria e Outbox

## Princípio

**Alteração de domínio + versão + auditoria + outbox acontecem na mesma transação PostgreSQL.** Se a auditoria falhar, a alteração falha.

O interceptor HTTP **não** grava auditoria de negócio: apenas popula o `RequestContext` (IP, User-Agent, `requestId`, `correlationId`, `sessionId`, membership, papel) consumido pela `UnitOfWork`.

## UnitOfWork

```ts
await uow.run(async (tx) => {
  const before = await tx.loadingOrder.findUniqueOrThrow({ where: { id } });
  const after = await tx.loadingOrder.update({ where: { id }, data });
  const version = await versions.bump(tx, before, after);           // se material
  await tx.audit({ entityType: 'loading_order', entityId: id, action: 'order.updated', before, after });
  await tx.outbox({ type: 'order.version_created', aggregateId: id, payload: { version } });
});
```

`uow.run` = `db.run(ctx, …)` (transação curta com contexto RLS) + helpers `audit()` e `outbox()` que leem o `RequestContext`. Não existe forma de chamar `audit()` fora de uma transação.

## audit_events

Campos: `tenant_id`, `actor_user_id`, `actor_membership_id`, `actor_role`, `entity_type`, `entity_id`, `action`, `before`, `after`, `metadata`, `ip`, `user_agent`, `session_id`, `request_id`, `correlation_id`, `occurred_at`.

- `before/after` passam por **redação**: campos sensíveis (`password_hash`, `secret_enc`, `token_hash`, `code_hash`) são removidos por lista central.
- Para updates, `after` pode conter apenas o diff + `before` completo dos campos alterados.

### Imutabilidade (append-only)

- `REVOKE UPDATE, DELETE, TRUNCATE ON audit_events FROM ordens_app`.
- Trigger `BEFORE UPDATE OR DELETE` que lança exceção (protege inclusive contra owner acidental).
- Nenhum endpoint de alteração. Retenção/arquivamento futuro: particionamento mensal + export para storage frio por job administrativo com role dedicada.

## Eventos de autenticação

Login falho ocorre antes de haver tenant: grava `audit_events` com `tenant_id` nulo via `db.system()` (tabela permite `tenant_id` null apenas para ações `auth.*`), além de `login_attempts`.

## Outbox

`outbox_events(id, tenant_id, type, aggregate_type, aggregate_id, payload, created_at, published_at, attempts, last_error)`.

- Relay no worker: a cada 1 s (e em `LISTEN outbox` via `pg_notify` do trigger), `SELECT … FOR UPDATE SKIP LOCKED LIMIT 100 WHERE published_at IS NULL`, publica no BullMQ com `jobId = event.id`, marca `published_at`.
- Entrega **pelo menos uma vez**; consumidores idempotentes por `event_id`.
- Falhas: `attempts++`, backoff; após N tentativas o job vai para a fila `dead-letter` com alerta em log estruturado.

## Timeline

A timeline da OC é uma projeção de `audit_events` + `loading_order_views` + `load_status_history` filtrada por `entity_id`/`order_id`, com rótulos amigáveis e respeitando visibilidade do escopo (Fazenda não vê observações internas).
