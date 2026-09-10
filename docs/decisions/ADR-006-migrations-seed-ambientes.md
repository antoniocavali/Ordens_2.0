# ADR-006 — Migrations e seed distintos por ambiente

**Status**: Aceito · 2026-09-10

## Decisão
- **Dev**: serviço `migrate` do compose aplica migrations e (com `SEED_DEMO=true`) seed demo automaticamente.
- **Produção**: migration é um **job explícito de release**, executado uma única vez antes da nova versão; API e worker nunca migram no boot.
- Seed demo aborta em `NODE_ENV=production` ou sem `SEED_DEMO=true`.
- Senha demo via `SEED_DEMO_PASSWORD`; se ausente, gerada aleatoriamente e exibida uma vez no log do primeiro boot dev. Nenhuma senha documentada.
- Dados de referência (permissões, papéis, unidades) são sincronizados de forma idempotente pelo job de migration em todos os ambientes.
