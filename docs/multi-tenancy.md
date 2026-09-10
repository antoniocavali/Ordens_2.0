# Estratégia Multi-Tenant

## Modelo

- **Tenant** = cliente contratante (workspace). Banco compartilhado, schema compartilhado, coluna `tenant_id`.
- **Organization** = empresa participante dentro do tenant: `MATRIZ`, `FARM`, `BUYER`, `CARRIER`. Organizações externas representam um `business_partner`.
- **Membership** = vínculo de um usuário global a um tenant + organização + escopo, com papéis.

## Duas camadas de isolamento

1. **Aplicação**: `@RequirePermission()` + serviços que sempre recebem o `RequestContext` (nunca `tenantId` vindo do body).
2. **Banco (RLS)**: toda tabela de negócio com `ENABLE` + `FORCE ROW LEVEL SECURITY`. A aplicação conecta **somente** como `ordens_app` (`NOSUPERUSER NOBYPASSRLS`, não dona das tabelas).

## Roles PostgreSQL

| Role | Uso | Privilégios |
|---|---|---|
| `postgres` | bootstrap do container | superuser, apenas init |
| `ordens_owner` | migrations (job de release / serviço `migrate` dev) | dono do schema e tabelas |
| `ordens_app` | API e worker | `SELECT/INSERT/UPDATE` conforme tabela; sem `DELETE` em auditoria; `NOBYPASSRLS` |

Um teste de integração verifica `select rolbypassrls, rolsuper from pg_roles where rolname = current_user` = `false/false` e falha caso contrário — impede testes "verdes" rodando como owner.

## Contexto de segurança no banco

Definido por transação curta (`set_config(name, value, is_local => true)`):

| GUC | Conteúdo |
|---|---|
| `app.tenant_id` | uuid do tenant ativo |
| `app.user_id` | uuid do usuário |
| `app.membership_id` | uuid da membership ativa |
| `app.scope` | `PLATFORM` \| `MATRIZ` \| `FARM` \| `BUYER` \| `CARRIER` \| `SYSTEM` |
| `app.org_ids` | lista de uuids de organizações autorizadas (`{uuid,uuid}`) |

Funções `STABLE`: `app_tenant_id()`, `app_user_id()`, `app_scope()`, `app_org_ids()` — retornam `NULL`/vazio quando não definidas, fazendo as políticas negarem por padrão (**fail closed**).

## Políticas

Padrão para tabelas de tenant:

```sql
create policy tenant_isolation on <tabela>
  as permissive for all to ordens_app
  using (tenant_id = app_tenant_id())
  with check (tenant_id = app_tenant_id());
```

Políticas **restritivas** adicionais por organização (combinadas com AND):

```sql
create policy org_scope on loading_orders
  as restrictive for all to ordens_app
  using (
    app_scope() in ('MATRIZ','SYSTEM')
    or (app_scope() = 'FARM'  and status <> 'DRAFT' and seller_org_id = any(app_org_ids()))
    or (app_scope() = 'BUYER' and status <> 'DRAFT' and buyer_org_id  = any(app_org_ids()))
  )
  with check (app_scope() in ('MATRIZ','SYSTEM'));
```

O `with check` impede que FARM/BUYER insiram ou atualizem OCs mesmo que a API tenha um bug.

Tabelas de identidade global (`users`, `sessions`, `login_attempts`, `two_factor_credentials`, `recovery_codes`, `password_reset_tokens`) não são de um tenant. São acessadas apenas pelo módulo `auth` com políticas por `app_user_id()` ou pelo escopo `SYSTEM` (fase pré-autenticação), que só pode ser aberto por `db.system()` — função única, revisável e auditada em code review.

## Limites honestos do RLS

Os GUCs `app.*` podem ser definidos pela própria role da aplicação. O RLS protege contra **erros de programação** (WHERE esquecido, IDOR, join errado) — não contra execução de código arbitrário no processo da API. Por isso: nunca SQL dinâmico com entrada de usuário, `db.system()` restrito, e revisão obrigatória de mudanças em `packages/db/src/context.ts`.

## Superadmin

`PLATFORM` gerencia `tenants`. Para agir dentro de um tenant, usa uma membership explícita naquele tenant (suporte), registrada em auditoria. Não existe "ver todos os tenants" em tabelas de negócio.

## Testes negativos obrigatórios

- Tenant A × Tenant B: leitura e escrita, com `select *` sem WHERE.
- Fazenda A × Fazenda B (mesmo tenant).
- Comprador A × Comprador B.
- FARM/BUYER: `INSERT`/`UPDATE` em `loading_orders` negado por RLS.
- FARM não vê OC em `DRAFT` nem da própria org.
- Contexto ausente → zero linhas.
