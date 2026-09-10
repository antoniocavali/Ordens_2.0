# ADR-003 — Auditoria, versão e outbox na mesma transação

**Status**: Aceito · 2026-09-10

## Decisão
- `UnitOfWork.run()` executa domínio + `loading_order_versions` + `audit_events` + `outbox_events` na mesma transação. Falha em qualquer parte → rollback.
- Interceptor HTTP apenas enriquece o `RequestContext` (IP, UA, requestId, correlationId, sessão).
- `audit_events` append-only: sem `UPDATE/DELETE/TRUNCATE` para `ordens_app` + trigger bloqueante.
- Integrações assíncronas somente via outbox (relay → BullMQ, entrega at-least-once, consumidores idempotentes).

## Consequências
+ Impossível ter alteração sem trilha, ou evento publicado de transação revertida.
− Escritas um pouco mais pesadas; `audit_events` cresce rápido → particionamento futuro.
