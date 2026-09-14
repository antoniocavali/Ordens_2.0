-- Papéis personalizados por tenant (Q35), concessões individuais de permissão (Q34)
-- e senha provisória com troca obrigatória no próximo acesso.

create type custom_role_status as enum ('ACTIVE', 'ARCHIVED');

create table tenant_roles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  name text not null check (length(name) between 3 and 60),
  description text check (description is null or length(description) <= 200),
  scope scope_type not null check (scope <> 'PLATFORM'),
  status custom_role_status not null default 'ACTIVE',
  created_by uuid references users(id),
  created_at timestamptz(6) not null default now(),
  updated_at timestamptz(6) not null
);
create unique index tenant_roles_tenant_name_key on tenant_roles (tenant_id, lower(name));
create index tenant_roles_tenant_scope_idx on tenant_roles (tenant_id, scope);

create table tenant_role_permissions (
  role_id uuid not null references tenant_roles(id) on delete cascade,
  tenant_id uuid not null references tenants(id),
  permission_code text not null references permissions(code),
  primary key (role_id, permission_code)
);

create table membership_custom_roles (
  membership_id uuid not null references memberships(id) on delete cascade,
  role_id uuid not null references tenant_roles(id),
  tenant_id uuid not null references tenants(id),
  created_at timestamptz(6) not null default now(),
  primary key (membership_id, role_id)
);
create index membership_custom_roles_role_idx on membership_custom_roles (tenant_id, role_id);

create table membership_permission_grants (
  membership_id uuid not null references memberships(id) on delete cascade,
  permission_code text not null references permissions(code),
  tenant_id uuid not null references tenants(id),
  granted_by uuid references users(id),
  created_at timestamptz(6) not null default now(),
  primary key (membership_id, permission_code)
);
create index membership_permission_grants_tenant_idx on membership_permission_grants (tenant_id);

grant delete on tenant_role_permissions, membership_custom_roles, membership_permission_grants to ordens_app;

do $$
declare t text;
begin
  foreach t in array array['tenant_roles', 'tenant_role_permissions', 'membership_custom_roles', 'membership_permission_grants'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format(
      'create policy tenant_isolation on %I as permissive for all
         using (tenant_id = app_tenant_id()) with check (tenant_id = app_tenant_id())', t);
  end loop;
end $$;

-- Papéis e suas permissões: leitura no tenant; criação e edição só pela Matriz.
create policy tenant_roles_insert on tenant_roles as restrictive for insert with check (app_scope() in ('MATRIZ', 'SYSTEM'));
create policy tenant_roles_update on tenant_roles as restrictive for update
  using (app_scope() in ('MATRIZ', 'SYSTEM')) with check (app_scope() in ('MATRIZ', 'SYSTEM'));
create policy tenant_role_permissions_insert on tenant_role_permissions as restrictive for insert with check (app_scope() in ('MATRIZ', 'SYSTEM'));
create policy tenant_role_permissions_delete on tenant_role_permissions as restrictive for delete using (app_scope() in ('MATRIZ', 'SYSTEM'));

-- Atribuição: só em acessos visíveis e com papel ativo do mesmo escopo do acesso.
create policy membership_custom_roles_scope on membership_custom_roles as restrictive for all
  using (exists (select 1 from memberships m where m.id = membership_id))
  with check (
    exists (
      select 1 from memberships m join tenant_roles r on r.id = role_id
      where m.id = membership_id and r.scope = m.scope and r.status = 'ACTIVE'
    )
  );

-- Concessões individuais: só a Matriz concede, e só para acessos da Matriz.
create policy membership_permission_grants_insert on membership_permission_grants as restrictive for insert
  with check (
    app_scope() in ('MATRIZ', 'SYSTEM')
    and exists (select 1 from memberships m where m.id = membership_id and m.scope = 'MATRIZ')
  );
create policy membership_permission_grants_delete on membership_permission_grants as restrictive for delete
  using (app_scope() in ('MATRIZ', 'SYSTEM'));

-- ─── Senha provisória ───
alter table users add column must_change_password boolean not null default false;
alter type session_stage add value if not exists 'PENDING_PASSWORD_CHANGE';
