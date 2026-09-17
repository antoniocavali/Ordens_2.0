# Matriz de Permissões (RBAC)

A fonte de verdade do catálogo é `packages/contracts/src/permissions.ts`; o seed sincroniza `permissions`, `roles` e `role_permissions`.

Cada requisição autenticada possui **uma membership ativa** (tenant + organização + escopo). A API valida a permissão com `@RequirePermission()`; o PostgreSQL restringe as linhas por tenant e organização via RLS. **Ocultar botões é apenas UX.**

## Escopos

| Escopo | Organização | Enxerga |
|---|---|---|
| `PLATFORM` | — | tabela `tenants`; dados de tenant só ao entrar explicitamente em um tenant (auditado) |
| `MATRIZ` | org `MATRIZ` | todos os dados do tenant |
| `FARM` | org `FARM` | OCs **publicadas** (nunca `DRAFT`/`PENDING_BILLING`) com fazenda definida e `seller_org_id ∈ org_ids`, suas fazendas, cargas/agendamentos dessas OCs, documentos com visibilidade `FARM`/`PARTIES` |
| `BUYER` | org `BUYER` | OCs da organização (`buyer_org_id ∈ org_ids`) a partir de `PENDING_BILLING`, os **próprios** rascunhos do portal, cargas dessas OCs, documentos `BUYER`/`PARTIES`, transportadoras (para escolher a preferencial) |
| `CARRIER` | org `CARRIER` | futuro: agendamentos/cargas atribuídos |

## Papéis

| Código | Nome | Escopo |
|---|---|---|
| `PLATFORM_SUPERADMIN` | Superadministrador SaaS | PLATFORM |
| `MATRIZ_ADMIN` | Administrador Matriz | MATRIZ |
| `MATRIZ_MANAGER` | Gestor Matriz | MATRIZ |
| `MATRIZ_OPERATOR` | Operador Matriz | MATRIZ |
| `MATRIZ_VIEWER` | Somente leitura Matriz | MATRIZ |
| `MATRIZ_SUPPORT_AGENT` | Atendente (leitura Matriz + atendimento nas filas definidas na equipe) | MATRIZ |
| `MATRIZ_BILLING` | Faturamento (leitura Matriz + `order.update` + `order.billing.manage` + atendimento) | MATRIZ |
| `FARM_ADMIN` | Administrador Fazenda | FARM |
| `FARM_OPERATOR` | Operador Fazenda | FARM |
| `BUYER_USER` | Comprador | BUYER |
| `CARRIER_USER` | Usuário Transportadora (futuro) | CARRIER |

## Papéis personalizados, concessões individuais e senha provisória

Permissões efetivas de um acesso = **papéis do sistema** (catálogo fixo em `@ordens/contracts`) + **papéis personalizados** ativos do tenant + **concessões individuais**. A sessão calcula e guarda em cache (60 s); qualquer mudança sinaliza revalidação imediata (`signalAuthzChange`).

| Recurso | Onde | Quem gerencia | Regras |
|---|---|---|---|
| Papéis do sistema | `roles` / `role_permissions` (seed) | ninguém (somente consulta) | Fixos; podem ser duplicados como base |
| Papéis personalizados | `tenant_roles`, `tenant_role_permissions`, `membership_custom_roles` | `role.manage` (Administrador Matriz) em Gestão → Papéis e permissões | Por tipo de organização; só permissões que algum papel do sistema do mesmo tipo já tem (Q35); RLS: leitura no tenant, escrita só Matriz; atribuição só a acesso do mesmo tipo |
| Concessão individual | `membership_permission_grants` | `user.manage` na Matriz, no drawer do usuário | Hoje só `user.password.manage`; só acessos da Matriz (Q34) |
| Senha provisória | `users.must_change_password` + estágio `PENDING_PASSWORD_CHANGE` | `user.password.manage` | Derruba sessões; troca obrigatória no próximo acesso; não vale para si, administradores (salvo por Administrador Matriz) nem para quem acessa outro tenant |

| Permissão | M_ADMIN | Demais papéis do sistema | Papel personalizado / concessão |
|---|---|---|---|
| `role.manage` | ● | — | papel personalizado da Matriz |
| `user.password.manage` | ● | — | papel personalizado da Matriz ou concessão individual |

## Atendimento (filas)

| Permissão | M_ADMIN | M_MGR | M_OPER | ATENDENTE | M_VIEW | Fazenda / Comprador / Transportadora |
|---|---|---|---|---|---|---|
| `support.use` (abrir conversa pelo chat) | ● | ● | ● | ● | ● | ● |
| `support.attend` (pode atender; filas definidas na equipe) | ● | ● | ● | ● | — | — |
| `support.manage` (supervisão: todas as filas, equipe, visão geral, conversas com o assistente) | ● | ● | — | — | — | — |

As **filas** de cada atendente ficam em `support_queue_members` e são definidas pela supervisão na tela Atendimento → Equipe (Q31). Endpoints do painel exigem `support.attend` ou `support.manage` (`RequireAnyPermission`); o serviço restringe lista, detalhe, ações e indicadores às filas do usuário. `/auth/me` retorna `supportQueues` para a navegação.

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
| `order.submit` (portal: criar, editar próprios rascunhos, enviar ao Faturamento, cancelar antes da análise) | — | — | — | — | — | — | — | ○ |
| `order.billing.manage` (definir vendedor/fazenda, publicar ou devolver solicitações; também papel Faturamento) | — | ● | ● | — | — | — | — | — |
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

Transições de carga possuem permissão por transição (ver [state-machines.md](state-machines.md)); "Documentação fiscal validada" e "Em trânsito" só por FARM ou MATRIZ e com o checklist fiscal completo.

## Portal do Comprador e Faturamento (Q41)

Defesa em camadas — nenhuma regra depende só de ocultar botões:

| Regra | API/domínio | Banco |
|---|---|---|
| Comprador cria só para a própria organização | `POST /orders/buyer` (`order.submit`, escopo BUYER); comprador derivado de `organizations.partner_id`; schema estrito | `orders_scope_insert`: `origin = BUYER`, `status = DRAFT`, `created_by = app_user_id()`, `buyer_org_id ∈ org_ids`, sem vendedor/fazenda/contrato |
| Comprador altera só rascunhos próprios | `assertOwnBuyerDraft` (422 após o envio) | `orders_scope_update` (USING `DRAFT`/`PENDING_BILLING` + criador) + trigger: solicitação enviada só pode ir para `CANCELLED`, sem mudar dados |
| Comprador cancela só antes da análise | `cancelBuyerOrder` (422 com fazenda definida) | trigger `loading_orders_buyer_guard` (sem vendedor/fazenda, motivo e autor obrigatórios) |
| Devolução é da Matriz | `returnToBuyer` (`order.billing.manage`) | trigger impede o Comprador de alterar `returned_*`; constraint exige motivo |
| Comprador nunca define fazenda, vendedor, contrato, preço, status publicado ou campos internos | schema estrito + endpoints próprios; endpoints administrativos exigem escopo MATRIZ | políticas acima + trigger `loading_orders_buyer_guard` (preço, frete, notas internas/Fazenda, instruções, liberação, totais, versão, publicação, `submitted_by`) |
| Fazenda só acessa ordens publicadas com a própria fazenda | detalhe/listas sob RLS | `orders_scope_read`: FARM exige status ≠ `DRAFT`/`PENDING_BILLING` e `farm_id` definido |
| Faturamento trata todas as solicitações do tenant | `order.billing.manage` + escopo MATRIZ | leitura/escrita internas |
| Numeração da solicitação | `nextSequence('loading_order')` | `tenant_sequences`: Comprador só a sequência `loading_order` |

## Testes obrigatórios

- Fazenda recebe **403** em `POST /orders` (guard) **e** `INSERT` direto em `loading_orders` com contexto FARM é negado pelo RLS; Comprador só insere rascunho do portal da própria organização.
- Usuário FARM da org A não lista OCs da org B; BUYER idem.
- MATRIZ_VIEWER recebe 403 em qualquer `*.manage`/`order.*` de escrita.
