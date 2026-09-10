# Matriz de Permissões (RBAC)

A fonte de verdade do catálogo é `packages/contracts/src/permissions.ts`; o seed sincroniza `permissions`, `roles` e `role_permissions`.

Cada requisição autenticada possui **uma membership ativa** (tenant + organização + escopo). A API valida a permissão com `@RequirePermission()`; o PostgreSQL restringe as linhas por tenant e organização via RLS. **Ocultar botões é apenas UX.**

## Escopos

| Escopo | Organização | Enxerga |
|---|---|---|
| `PLATFORM` | — | tabela `tenants`; dados de tenant só ao entrar explicitamente em um tenant (auditado) |
| `MATRIZ` | org `MATRIZ` | todos os dados do tenant |
| `FARM` | org `FARM` | OCs **publicadas** onde `seller_org_id ∈ org_ids`, suas fazendas, cargas/agendamentos dessas OCs, documentos com visibilidade `FARM` |
| `BUYER` | org `BUYER` | OCs **publicadas** onde `buyer_org_id ∈ org_ids`, cargas dessas OCs, documentos `BUYER` |
| `CARRIER` | org `CARRIER` | futuro: agendamentos/cargas atribuídos |

## Papéis

| Código | Nome | Escopo |
|---|---|---|
| `PLATFORM_SUPERADMIN` | Superadministrador SaaS | PLATFORM |
| `MATRIZ_ADMIN` | Administrador Matriz | MATRIZ |
| `MATRIZ_MANAGER` | Gestor Matriz | MATRIZ |
| `MATRIZ_OPERATOR` | Operador Matriz | MATRIZ |
| `MATRIZ_VIEWER` | Somente leitura Matriz | MATRIZ |
| `FARM_ADMIN` | Administrador Fazenda | FARM |
| `FARM_OPERATOR` | Operador Fazenda | FARM |
| `BUYER_USER` | Comprador | BUYER |
| `CARRIER_USER` | Usuário Transportadora (futuro) | CARRIER |

## Matriz

Legenda: ● permitido · ○ restrito ao próprio escopo/organização · — negado

| Permissão | SUPER | M_ADMIN | M_MGR | M_OPER | M_VIEW | F_ADMIN | F_OPER | BUYER |
|---|---|---|---|---|---|---|---|---|
| `tenant.manage` | ● | — | — | — | — | — | — | — |
| `security.policy.manage` | ● | ● | — | — | — | — | — | — |
| `organization.read` | ● | ● | ● | ● | ● | ○ | ○ | ○ |
| `organization.manage` | ● | ● | — | — | — | — | — | — |
| `user.read` | ● | ● | ● | — | — | ○ | — | — |
| `user.manage` | ● | ● | — | — | — | ○ | — | — |
| `audit.read` | ● | ● | ● | — | — | — | — | — |
| `partner.read` | — | ● | ● | ● | ● | ○ | ○ | ○ |
| `partner.manage` | — | ● | ● | ● | — | — | — | — |
| `farm.read` | — | ● | ● | ● | ● | ○ | ○ | — |
| `farm.manage` | — | ● | ● | ● | — | ○ | — | — |
| `commodity.read` | — | ● | ● | ● | ● | ● | ● | ● |
| `commodity.manage` | — | ● | ● | — | — | — | — | — |
| `contract.read` | — | ● | ● | ● | ● | ○ | — | ○ |
| `contract.manage` | — | ● | ● | — | — | — | — | — |
| `carrier.read` | — | ● | ● | ● | ● | ● | ● | — |
| `carrier.manage` | — | ● | ● | ● | — | — | — | — |
| `order.read` | — | ● | ● | ● | ● | ○ | ○ | ○ |
| `order.create` | — | ● | ● | ● | — | — | — | — |
| `order.update` | — | ● | ● | ● | — | — | — | — |
| `order.publish` | — | ● | ● | — | — | — | — | — |
| `order.cancel` | — | ● | ● | — | — | — | — | — |
| `order.release` | — | ● | ● | — | — | — | — | — |
| `appointment.read` | — | ● | ● | ● | ● | ○ | ○ | ○ |
| `appointment.manage` | — | ● | ● | ● | — | ○ | ○ | — |
| `load.read` | — | ● | ● | ● | ● | ○ | ○ | ○ |
| `load.manage` | — | ● | ● | ● | — | ○ | ○ | — |
| `occurrence.read` | — | ● | ● | ● | ● | ○ | ○ | ○ |
| `occurrence.manage` | — | ● | ● | ● | — | ○ | ○ | — |
| `document.read` | — | ● | ● | ● | ● | ○ | ○ | ○ |
| `document.upload` | — | ● | ● | ● | — | ○ | ○ | — |
| `invoice.upload` | — | ● | ● | ● | — | ○ | ○ | — |
| `dashboard.matriz` | — | ● | ● | ● | ● | — | — | — |
| `dashboard.farm` | — | — | — | — | — | ● | ● | — |
| `dashboard.buyer` | — | — | — | — | — | — | — | ● |
| `report.export` | — | ● | ● | — | — | — | — | — |
| `settings.manage` | — | ● | — | — | — | — | — | — |

Transições de carga possuem permissão por transição (ver [state-machines.md](state-machines.md)); ex.: `FATURADA_FAZENDA` só por escopo FARM ou MATRIZ.

## Testes obrigatórios

- Fazenda e Comprador recebem **403** em `POST /orders` (guard) **e** `INSERT` direto em `loading_orders` com contexto FARM/BUYER é negado pelo RLS.
- Usuário FARM da org A não lista OCs da org B; BUYER idem.
- MATRIZ_VIEWER recebe 403 em qualquer `*.manage`/`order.*` de escrita.
