# Versionamento da OC e Faróis de Visualização

## Campos materiais

Alteração em qualquer um destes campos após a publicação gera **nova versão**:

`quantity`, `unit_id`, `commodity_id`, `farm_id`, `seller_partner_id`, `buyer_partner_id`, `contract_id`, `crop_year`, `loading_starts_on`, `loading_ends_on`, `destination`, `unit_price`, `currency`, `tolerance_pct`, `freight_mode`, `commercial_terms`, `loading_instructions`, `farm_notes`, `buyer_notes`, criação/cancelamento de **liberação**.

Não materiais (não geram versão): `internal_notes`, `priority`, `external_number`, totais derivados de cargas.

A lista vive em `@ordens/contracts` (`ORDER_MATERIAL_FIELDS`) e é coberta por teste.

## Fluxo

- `DRAFT`: `version = 0`, sem snapshots (autosave livre, auditado de forma agregada).
- Publicação: `version = 1`, snapshot em `loading_order_versions` com `material_snapshot` completo.
- Alteração material: `version++`, snapshot + `changed_fields` (`[{field, from, to}]`), `audit_events` e `outbox order.version_created`, tudo na mesma transação.
- Controle de concorrência otimista: toda escrita envia `expectedVersion`/`updatedAt`; divergência → `409 ORDER_STALE`.

## Visualização

Registrada **somente** em `POST /orders/:id/views` chamado ao abrir o detalhe ou o Quick View completo. Renderização em tabela não conta.

Upsert em `loading_order_views` por `(order_id, organization_id, user_id, version)`: `first_viewed_at`, `last_viewed_at`, `view_count++`, IP, UA, `session_id`, `correlation_id`. Visualizações da própria Matriz não alteram faróis.

## Farol (por lado: Fazenda e Comprador)

Calculado para a organização do lado (`seller_org_id` / `buyer_org_id`):

| Estado | Regra | Cor | Ícone | Texto |
|---|---|---|---|---|
| `NEVER` | nenhuma view e dentro do SLA | cinza | `EyeOff` | Nunca visualizada |
| `CURRENT` | existe view com `version = order.version` | verde | `Eye` | Versão atual visualizada |
| `OUTDATED` | última view com `version < order.version` e dentro do SLA desde a nova versão | âmbar | `History` | Nova versão pendente |
| `OVERDUE` | sem view da versão atual e passou `tenants.view_sla_hours` desde `published_at`/última versão | vermelho | `AlertTriangle` | Não visualizada (SLA) |

Tooltip: usuário, data/hora e versão da última visualização. Clique: histórico. `aria-label` descreve estado completo. Nunca apenas cor.

O cálculo é feito em SQL (lateral join na última view por lado) para permitir filtro/ordenação server-side ("Não visualizadas").
