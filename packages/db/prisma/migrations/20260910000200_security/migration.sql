-- ════════════════════════════════════════════════════════════════════════════
-- Segurança: funções de contexto, grants, RLS por tenant e organização,
-- auditoria append-only, consistência de relações e índices especiais.
-- Documentação: docs/multi-tenancy.md, docs/audit-outbox.md
-- ════════════════════════════════════════════════════════════════════════════

create extension if not exists pgcrypto;
create extension if not exists pg_trgm;

-- ─── Funções de contexto (fail closed: ausência de contexto → NULL / vazio) ───

create or replace function app_tenant_id() returns uuid
  language sql stable parallel safe
  as $$ select nullif(current_setting('app.tenant_id', true), '')::uuid $$;

create or replace function app_user_id() returns uuid
  language sql stable parallel safe
  as $$ select nullif(current_setting('app.user_id', true), '')::uuid $$;

create or replace function app_membership_id() returns uuid
  language sql stable parallel safe
  as $$ select nullif(current_setting('app.membership_id', true), '')::uuid $$;

create or replace function app_scope() returns text
  language sql stable parallel safe
  as $$ select coalesce(nullif(current_setting('app.scope', true), ''), 'NONE') $$;

create or replace function app_org_ids() returns uuid[]
  language sql stable parallel safe
  as $$ select coalesce(nullif(current_setting('app.org_ids', true), '')::uuid[], '{}'::uuid[]) $$;

create or replace function app_is_internal() returns boolean
  language sql stable parallel safe
  as $$ select app_scope() in ('MATRIZ', 'SYSTEM') $$;

-- Políticas não usam TO <role>: valem para ordens_app e ordens_owner (FORCE RLS). Os GRANTs definem quem acessa.

-- ─── Grants ───

revoke all on all tables in schema public from public;
grant usage on schema public to ordens_app;
grant select, insert, update on all tables in schema public to ordens_app;
grant usage, select on all sequences in schema public to ordens_app;

-- Catálogo global de RBAC: somente leitura para a aplicação.
revoke insert, update on roles, permissions, role_permissions from ordens_app;

-- Tabela de controle do Prisma: fora do alcance da aplicação.
revoke all on _prisma_migrations from ordens_app;

-- Tabelas onde a remoção física é parte do fluxo (vínculos, preferências, credenciais substituídas).
grant delete on membership_roles, partner_roles, saved_views, recovery_codes,
  two_factor_credentials, webauthn_credentials to ordens_app;

-- Auditoria e tentativas de login: append-only.
revoke update, delete, truncate on audit_events, login_attempts from ordens_app;

alter default privileges for role ordens_owner in schema public
  grant select, insert, update on tables to ordens_app;
alter default privileges for role ordens_owner in schema public
  grant usage, select on sequences to ordens_app;

-- ─── Habilitar RLS (FORCE aplica inclusive ao dono das tabelas) ───

do $$
declare t text;
begin
  foreach t in array array[
    'tenants','organizations','users','memberships','membership_roles','sessions','login_attempts',
    'password_reset_tokens','two_factor_credentials','recovery_codes','webauthn_credentials',
    'user_preferences','saved_views','audit_events','outbox_events','file_uploads','notifications',
    'business_partners','partner_roles','farms','units','commodities','contracts','tenant_sequences',
    'loading_orders','loading_order_versions','loading_order_releases','loading_order_views'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
  end loop;
end $$;

-- ─── Isolamento de tenant (permissivo) para todas as tabelas com tenant_id obrigatório ───

do $$
declare t text;
begin
  foreach t in array array[
    'organizations','memberships','membership_roles','saved_views','file_uploads','notifications',
    'business_partners','partner_roles','farms','units','commodities','contracts','tenant_sequences',
    'loading_orders','loading_order_versions','loading_order_releases','loading_order_views'
  ] loop
    execute format(
      'create policy tenant_isolation on %I as permissive for all
         using (tenant_id = app_tenant_id()) with check (tenant_id = app_tenant_id())', t);
  end loop;
end $$;

-- ─── tenants ───

create policy tenants_read on tenants for select
  using (
    id = app_tenant_id()
    or app_scope() in ('PLATFORM', 'SYSTEM')
    or exists (select 1 from memberships m where m.tenant_id = tenants.id and m.user_id = app_user_id())
  );
create policy tenants_insert on tenants for insert
  with check (app_scope() in ('PLATFORM', 'SYSTEM'));
create policy tenants_update on tenants for update
  using (app_scope() in ('PLATFORM', 'SYSTEM') or (id = app_tenant_id() and app_scope() = 'MATRIZ'))
  with check (app_scope() in ('PLATFORM', 'SYSTEM') or (id = app_tenant_id() and app_scope() = 'MATRIZ'));

-- ─── Identidade global ───

create policy users_read on users for select
  using (
    app_scope() = 'SYSTEM'
    or id = app_user_id()
    or exists (select 1 from memberships m where m.user_id = users.id and m.tenant_id = app_tenant_id())
  );
create policy users_insert on users for insert
  with check (app_scope() in ('SYSTEM', 'PLATFORM', 'MATRIZ', 'FARM'));
create policy users_update on users for update
  using (app_scope() = 'SYSTEM' or id = app_user_id())
  with check (app_scope() = 'SYSTEM' or id = app_user_id());

do $$
declare t text;
begin
  foreach t in array array[
    'sessions','password_reset_tokens','two_factor_credentials','recovery_codes',
    'webauthn_credentials','user_preferences'
  ] loop
    execute format(
      'create policy own_rows on %I for all
         using (app_scope() = ''SYSTEM'' or user_id = app_user_id())
         with check (app_scope() = ''SYSTEM'' or user_id = app_user_id())', t);
  end loop;
end $$;

create policy login_attempts_read on login_attempts for select
  using (app_scope() = 'SYSTEM' or user_id = app_user_id());
create policy login_attempts_insert on login_attempts for insert
  with check (app_scope() = 'SYSTEM' or user_id = app_user_id());

-- ─── organizations ───

-- O usuário enxerga as organizações das próprias memberships em qualquer tenant (seletor de contexto).
create policy organizations_own_memberships on organizations as permissive for select
  using (exists (select 1 from memberships m where m.organization_id = organizations.id and m.user_id = app_user_id()));

create policy organizations_scope_read on organizations as restrictive for select
  using (
    app_scope() in ('MATRIZ', 'PLATFORM', 'SYSTEM')
    or id = any(app_org_ids())
    or kind = 'MATRIZ'
    or exists (select 1 from memberships m where m.organization_id = organizations.id and m.user_id = app_user_id())
  );
create policy organizations_scope_insert on organizations as restrictive for insert
  with check (app_scope() in ('MATRIZ', 'PLATFORM', 'SYSTEM'));
create policy organizations_scope_update on organizations as restrictive for update
  using (app_scope() in ('MATRIZ', 'PLATFORM', 'SYSTEM'))
  with check (app_scope() in ('MATRIZ', 'PLATFORM', 'SYSTEM'));

-- ─── memberships ───

create policy memberships_own on memberships as permissive for select
  using (user_id = app_user_id());

create policy memberships_scope_read on memberships as restrictive for select
  using (
    app_scope() in ('MATRIZ', 'PLATFORM', 'SYSTEM')
    or organization_id = any(app_org_ids())
    or user_id = app_user_id()
  );
create policy memberships_scope_insert on memberships as restrictive for insert
  with check (
    app_scope() in ('MATRIZ', 'PLATFORM', 'SYSTEM')
    or (organization_id = any(app_org_ids()) and scope::text = app_scope())
  );
create policy memberships_scope_update on memberships as restrictive for update
  using (app_scope() in ('MATRIZ', 'PLATFORM', 'SYSTEM') or organization_id = any(app_org_ids()))
  with check (
    app_scope() in ('MATRIZ', 'PLATFORM', 'SYSTEM')
    or (organization_id = any(app_org_ids()) and scope::text = app_scope())
  );

-- ─── membership_roles ───

create policy membership_roles_own on membership_roles as permissive for select
  using (exists (select 1 from memberships m where m.id = membership_id and m.user_id = app_user_id()));

create policy membership_roles_scope on membership_roles as restrictive for all
  using (exists (select 1 from memberships m where m.id = membership_id))
  with check (
    exists (
      select 1 from memberships m join roles r on r.code = role_code
      where m.id = membership_id and r.scope = m.scope
    )
  );

-- ─── Preferências e notificações do próprio usuário ───

create policy saved_views_owner on saved_views as restrictive for all
  using (app_scope() = 'SYSTEM' or user_id = app_user_id())
  with check (app_scope() = 'SYSTEM' or user_id = app_user_id());

create policy notifications_owner on notifications as restrictive for all
  using (app_scope() = 'SYSTEM' or user_id = app_user_id())
  with check (app_scope() = 'SYSTEM' or user_id = app_user_id());

-- ─── Cadastros ───

create policy partners_scope_read on business_partners as restrictive for select
  using (
    app_is_internal()
    or exists (select 1 from organizations o where o.partner_id = business_partners.id and o.id = any(app_org_ids()))
    or exists (
      select 1 from loading_orders lo
      where lo.seller_partner_id = business_partners.id or lo.buyer_partner_id = business_partners.id
    )
  );
create policy partners_scope_write on business_partners as restrictive for insert
  with check (app_is_internal());
create policy partners_scope_update on business_partners as restrictive for update
  using (app_is_internal()) with check (app_is_internal());

create policy partner_roles_scope on partner_roles as restrictive for all
  using (exists (select 1 from business_partners p where p.id = partner_id))
  with check (app_is_internal());

create policy farms_scope_read on farms as restrictive for select
  using (
    app_is_internal()
    or organization_id = any(app_org_ids())
    or exists (select 1 from loading_orders lo where lo.farm_id = farms.id)
  );
create policy farms_scope_insert on farms as restrictive for insert
  with check (app_is_internal() or (app_scope() = 'FARM' and organization_id = any(app_org_ids())));
create policy farms_scope_update on farms as restrictive for update
  using (app_is_internal() or (app_scope() = 'FARM' and organization_id = any(app_org_ids())))
  with check (app_is_internal() or (app_scope() = 'FARM' and organization_id = any(app_org_ids())));

do $$
declare t text;
begin
  foreach t in array array['units', 'commodities'] loop
    execute format(
      'create policy catalog_write_insert on %I as restrictive for insert with check (app_is_internal())', t);
    execute format(
      'create policy catalog_write_update on %I as restrictive for update using (app_is_internal()) with check (app_is_internal())', t);
  end loop;
end $$;

create policy contracts_scope_read on contracts as restrictive for select
  using (app_is_internal() or seller_org_id = any(app_org_ids()) or buyer_org_id = any(app_org_ids()));
create policy contracts_scope_insert on contracts as restrictive for insert
  with check (app_is_internal());
create policy contracts_scope_update on contracts as restrictive for update
  using (app_is_internal()) with check (app_is_internal());

create policy tenant_sequences_internal on tenant_sequences as restrictive for all
  using (app_is_internal()) with check (app_is_internal());

-- ─── Ordens de Carregamento ───

create policy orders_scope_read on loading_orders as restrictive for select
  using (
    app_is_internal()
    or (app_scope() = 'FARM'  and status <> 'DRAFT' and seller_org_id = any(app_org_ids()))
    or (app_scope() = 'BUYER' and status <> 'DRAFT' and buyer_org_id  = any(app_org_ids()))
  );
-- Fazenda e Comprador jamais inserem ou alteram OCs, mesmo com bug na API.
create policy orders_scope_insert on loading_orders as restrictive for insert
  with check (app_is_internal());
create policy orders_scope_update on loading_orders as restrictive for update
  using (app_is_internal()) with check (app_is_internal());

do $$
declare t text;
begin
  foreach t in array array['loading_order_versions', 'loading_order_releases'] loop
    execute format(
      'create policy order_child_read on %I as restrictive for select
         using (exists (select 1 from loading_orders o where o.id = order_id))', t);
    execute format(
      'create policy order_child_insert on %I as restrictive for insert with check (app_is_internal())', t);
    execute format(
      'create policy order_child_update on %I as restrictive for update
         using (app_is_internal()) with check (app_is_internal())', t);
  end loop;
end $$;

create policy order_views_read on loading_order_views as restrictive for select
  using (app_is_internal() or organization_id = any(app_org_ids()));
create policy order_views_insert on loading_order_views as restrictive for insert
  with check (
    app_scope() = 'SYSTEM'
    or (
      app_scope() in ('FARM', 'BUYER')
      and side::text = app_scope()
      and organization_id = any(app_org_ids())
      and user_id = app_user_id()
      and exists (select 1 from loading_orders o where o.id = order_id)
    )
  );
create policy order_views_update on loading_order_views as restrictive for update
  using (app_scope() = 'SYSTEM' or (organization_id = any(app_org_ids()) and user_id = app_user_id()))
  with check (app_scope() = 'SYSTEM' or (organization_id = any(app_org_ids()) and user_id = app_user_id()));

-- ─── Arquivos ───

create policy file_uploads_scope_read on file_uploads as restrictive for select
  using (app_is_internal() or organization_id = any(app_org_ids()));
create policy file_uploads_scope_insert on file_uploads as restrictive for insert
  with check (app_is_internal() or (organization_id = any(app_org_ids()) and created_by = app_user_id()));
create policy file_uploads_scope_update on file_uploads as restrictive for update
  using (app_is_internal() or (organization_id = any(app_org_ids()) and created_by = app_user_id()))
  with check (app_is_internal() or (organization_id = any(app_org_ids()) and created_by = app_user_id()));

-- ─── Auditoria (append-only) ───

create policy audit_read on audit_events for select
  using (
    app_scope() = 'SYSTEM'
    or (tenant_id = app_tenant_id() and app_scope() in ('MATRIZ', 'PLATFORM'))
    or (
      tenant_id = app_tenant_id()
      and app_scope() in ('FARM', 'BUYER')
      and entity_type = 'loading_order'
      and exists (select 1 from loading_orders o where o.id = entity_id)
    )
    or (tenant_id is null and actor_user_id = app_user_id())
  );
create policy audit_insert on audit_events for insert
  with check (
    app_scope() = 'SYSTEM'
    or tenant_id = app_tenant_id()
    or (tenant_id is null and action like 'auth.%' and actor_user_id = app_user_id())
  );

create or replace function audit_events_immutable() returns trigger
  language plpgsql as $$
begin
  raise exception 'audit_events é append-only' using errcode = '42501';
end $$;

create trigger audit_events_no_update before update or delete on audit_events
  for each row execute function audit_events_immutable();
create trigger audit_events_no_truncate before truncate on audit_events
  for each statement execute function audit_events_immutable();

-- ─── Outbox ───

create policy outbox_insert on outbox_events for insert
  with check (app_scope() = 'SYSTEM' or tenant_id = app_tenant_id());
create policy outbox_system on outbox_events for select
  using (app_scope() = 'SYSTEM');
create policy outbox_system_update on outbox_events for update
  using (app_scope() = 'SYSTEM') with check (app_scope() = 'SYSTEM');

create index outbox_events_pending_idx on outbox_events (created_at) where published_at is null;

create or replace function outbox_notify() returns trigger
  language plpgsql as $$
begin
  perform pg_notify('outbox', new.id::text);
  return new;
end $$;

create trigger outbox_events_notify after insert on outbox_events
  for each row execute function outbox_notify();

-- ─── Integridade relacional e denormalizações usadas pelo RLS ───

alter table loading_orders
  add constraint loading_orders_contract_fk foreign key (contract_id) references contracts(id),
  add constraint loading_orders_seller_fk foreign key (seller_partner_id) references business_partners(id),
  add constraint loading_orders_buyer_fk foreign key (buyer_partner_id) references business_partners(id),
  add constraint loading_orders_farm_fk foreign key (farm_id) references farms(id),
  add constraint loading_orders_commodity_fk foreign key (commodity_id) references commodities(id),
  add constraint loading_orders_unit_fk foreign key (unit_id) references units(id),
  add constraint loading_orders_carrier_fk foreign key (preferred_carrier_id) references business_partners(id),
  add constraint loading_orders_tenant_fk foreign key (tenant_id) references tenants(id),
  add constraint loading_orders_quantity_positive check (quantity is null or quantity > 0),
  add constraint loading_orders_totals_non_negative check (
    released_qty >= 0 and scheduled_qty >= 0 and loaded_qty >= 0 and in_transit_qty >= 0
    and received_qty >= 0 and cancelled_qty >= 0
  ),
  add constraint loading_orders_window check (
    loading_starts_on is null or loading_ends_on is null or loading_starts_on <= loading_ends_on
  ),
  add constraint loading_orders_tolerance check (tolerance_pct >= 0 and tolerance_pct <= 100);

alter table contracts
  add constraint contracts_seller_fk foreign key (seller_partner_id) references business_partners(id),
  add constraint contracts_buyer_fk foreign key (buyer_partner_id) references business_partners(id),
  add constraint contracts_commodity_fk foreign key (commodity_id) references commodities(id),
  add constraint contracts_unit_fk foreign key (unit_id) references units(id),
  add constraint contracts_tenant_fk foreign key (tenant_id) references tenants(id),
  add constraint contracts_quantity_positive check (quantity > 0);

alter table loading_order_releases
  add constraint loading_order_releases_quantity_positive check (quantity > 0);

alter table business_partners add constraint business_partners_tenant_fk foreign key (tenant_id) references tenants(id);
alter table farms add constraint farms_tenant_fk foreign key (tenant_id) references tenants(id);
alter table commodities add constraint commodities_tenant_fk foreign key (tenant_id) references tenants(id);
alter table units add constraint units_tenant_fk foreign key (tenant_id) references tenants(id);
alter table commodities add constraint commodities_default_unit_fk foreign key (default_unit_id) references units(id);
alter table file_uploads add constraint file_uploads_tenant_fk foreign key (tenant_id) references tenants(id);
alter table file_uploads add constraint file_uploads_org_fk foreign key (organization_id) references organizations(id);

-- Uma organização FARM/BUYER por parceiro dentro do tenant.
create unique index organizations_partner_kind_uidx on organizations (tenant_id, partner_id, kind)
  where partner_id is not null;

-- Membership deve ter escopo compatível com o tipo da organização e o mesmo tenant.
create or replace function memberships_check() returns trigger
  language plpgsql as $$
declare org_kind_v org_kind; org_tenant uuid;
begin
  select kind, tenant_id into org_kind_v, org_tenant from organizations where id = new.organization_id;
  if org_tenant is null or org_tenant <> new.tenant_id then
    raise exception 'Organização inválida para o tenant' using errcode = '23514', hint = 'INCONSISTENT_RELATION';
  end if;
  if org_kind_v::text <> new.scope::text then
    raise exception 'Escopo da membership incompatível com a organização' using errcode = '23514', hint = 'INCONSISTENT_RELATION';
  end if;
  return new;
end $$;

create trigger memberships_check before insert or update on memberships
  for each row execute function memberships_check();

create or replace function org_for_partner(p_tenant uuid, p_partner uuid, p_kind org_kind) returns uuid
  language sql stable as $$
  select o.id from organizations o
  where o.tenant_id = p_tenant and o.partner_id = p_partner and o.kind = p_kind
  limit 1
$$;

-- Deriva seller_org_id/buyer_org_id e garante consistência Vendedor→Fazenda e Contrato→partes.
create or replace function loading_orders_derive() returns trigger
  language plpgsql as $$
declare
  farm_owner uuid; farm_org uuid; farm_tenant uuid;
  c record;
begin
  if new.farm_id is not null then
    select owner_partner_id, organization_id, tenant_id into farm_owner, farm_org, farm_tenant
      from farms where id = new.farm_id;
    if farm_tenant is null or farm_tenant <> new.tenant_id then
      raise exception 'Fazenda inexistente' using errcode = '23514', hint = 'INCONSISTENT_RELATION';
    end if;
    if new.seller_partner_id is null or farm_owner <> new.seller_partner_id then
      raise exception 'A fazenda não pertence ao vendedor informado' using errcode = '23514', hint = 'INCONSISTENT_RELATION';
    end if;
  end if;

  if new.contract_id is not null then
    select seller_partner_id, buyer_partner_id, commodity_id, tenant_id into c from contracts where id = new.contract_id;
    if c.tenant_id is null or c.tenant_id <> new.tenant_id then
      raise exception 'Contrato inexistente' using errcode = '23514', hint = 'INCONSISTENT_RELATION';
    end if;
    if (new.seller_partner_id is not null and new.seller_partner_id <> c.seller_partner_id)
       or (new.buyer_partner_id is not null and new.buyer_partner_id <> c.buyer_partner_id)
       or (new.commodity_id is not null and new.commodity_id <> c.commodity_id) then
      raise exception 'Vendedor, comprador ou commodity divergente do contrato' using errcode = '23514', hint = 'INCONSISTENT_RELATION';
    end if;
  end if;

  new.seller_org_id := case
    when new.seller_partner_id is null then null
    else coalesce(farm_org, org_for_partner(new.tenant_id, new.seller_partner_id, 'FARM'))
  end;
  new.buyer_org_id := case
    when new.buyer_partner_id is null then null
    else org_for_partner(new.tenant_id, new.buyer_partner_id, 'BUYER')
  end;
  return new;
end $$;

create trigger loading_orders_derive before insert or update on loading_orders
  for each row execute function loading_orders_derive();

create or replace function contracts_derive() returns trigger
  language plpgsql as $$
begin
  new.seller_org_id := org_for_partner(new.tenant_id, new.seller_partner_id, 'FARM');
  new.buyer_org_id := org_for_partner(new.tenant_id, new.buyer_partner_id, 'BUYER');
  return new;
end $$;

create trigger contracts_derive before insert or update on contracts
  for each row execute function contracts_derive();

-- ─── Busca ───

create index loading_orders_number_trgm on loading_orders using gin (number gin_trgm_ops);
create index business_partners_name_trgm on business_partners using gin (legal_name gin_trgm_ops);
create index business_partners_trade_trgm on business_partners using gin (trade_name gin_trgm_ops);
create index farms_name_trgm on farms using gin (name gin_trgm_ops);
