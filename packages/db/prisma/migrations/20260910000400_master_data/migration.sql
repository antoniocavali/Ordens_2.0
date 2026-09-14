-- Fase 3: cadastros mestres (contatos, transportadoras, motoristas, veículos).

create type vehicle_type as enum ('TRUCK_TRACTOR', 'TRAILER', 'SEMI_TRAILER', 'BITRAIN', 'ROAD_TRAIN', 'TRUCK', 'OTHER');

alter table farms add column contact_name text, add column contact_phone text;

create table partner_contacts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  partner_id uuid not null references business_partners(id) on delete cascade,
  name text not null,
  role text,
  phone text,
  email text,
  is_primary boolean not null default false,
  created_at timestamptz(6) not null default now()
);
create index partner_contacts_tenant_id_partner_id_idx on partner_contacts (tenant_id, partner_id);

create table carrier_profiles (
  partner_id uuid primary key references business_partners(id) on delete cascade,
  tenant_id uuid not null references tenants(id),
  rntrc text,
  rntrc_expires_at date,
  ops_contact_name text,
  ops_contact_phone text,
  ops_contact_email text,
  updated_at timestamptz(6) not null
);
create index carrier_profiles_tenant_id_idx on carrier_profiles (tenant_id);

create table drivers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  carrier_partner_id uuid references business_partners(id),
  name text not null,
  cpf text not null,
  phone text,
  email text,
  cnh_number text,
  cnh_category text,
  cnh_expires_at date,
  notes text,
  status record_status not null default 'ACTIVE',
  created_at timestamptz(6) not null default now(),
  updated_at timestamptz(6) not null,
  archived_at timestamptz(6)
);
create unique index drivers_tenant_id_cpf_key on drivers (tenant_id, cpf);
create index drivers_tenant_id_carrier_partner_id_idx on drivers (tenant_id, carrier_partner_id);
create index drivers_name_trgm on drivers using gin (name gin_trgm_ops);

create table vehicles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  carrier_partner_id uuid references business_partners(id),
  plate text not null,
  type vehicle_type not null,
  capacity_kg numeric(18, 4),
  axles integer,
  brand text,
  model text,
  year integer,
  renavam text,
  notes text,
  status record_status not null default 'ACTIVE',
  created_at timestamptz(6) not null default now(),
  updated_at timestamptz(6) not null,
  archived_at timestamptz(6),
  constraint vehicles_capacity_positive check (capacity_kg is null or capacity_kg > 0)
);
create unique index vehicles_tenant_id_plate_key on vehicles (tenant_id, plate);
create index vehicles_tenant_id_carrier_partner_id_idx on vehicles (tenant_id, carrier_partner_id);

-- Grants (default privileges cobrem SELECT/INSERT/UPDATE; contatos são substituídos por completo).
grant delete on partner_contacts to ordens_app;

-- RLS
do $$
declare t text;
begin
  foreach t in array array['partner_contacts', 'carrier_profiles', 'drivers', 'vehicles'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format(
      'create policy tenant_isolation on %I as permissive for all
         using (tenant_id = app_tenant_id()) with check (tenant_id = app_tenant_id())', t);
    execute format(
      'create policy registry_write_insert on %I as restrictive for insert with check (app_is_internal())', t);
    execute format(
      'create policy registry_write_update on %I as restrictive for update using (app_is_internal()) with check (app_is_internal())', t);
  end loop;
end $$;

create policy registry_write_delete on partner_contacts as restrictive for delete using (app_is_internal());

-- Contatos seguem a visibilidade do parceiro.
create policy partner_contacts_read on partner_contacts as restrictive for select
  using (exists (select 1 from business_partners p where p.id = partner_id));

-- Transportadoras, motoristas e veículos: Matriz e Fazenda (agendamentos); Comprador não.
do $$
declare t text;
begin
  foreach t in array array['carrier_profiles', 'drivers', 'vehicles'] loop
    execute format(
      'create policy carrier_scope_read on %I as restrictive for select
         using (app_scope() in (''MATRIZ'', ''SYSTEM'', ''FARM'', ''CARRIER''))', t);
  end loop;
end $$;

-- Fazenda enxerga parceiros transportadores (para agendar cargas).
drop policy partners_scope_read on business_partners;
create policy partners_scope_read on business_partners as restrictive for select
  using (
    app_is_internal()
    or exists (select 1 from organizations o where o.partner_id = business_partners.id and o.id = any(app_org_ids()))
    or exists (
      select 1 from loading_orders lo
      where lo.seller_partner_id = business_partners.id or lo.buyer_partner_id = business_partners.id
    )
    or (
      app_scope() = 'FARM'
      and exists (select 1 from partner_roles r where r.partner_id = business_partners.id and r.role = 'CARRIER')
    )
  );
