-- Locais de destino (Q39): armazéns, portos, indústrias e transbordos usados para preencher o destino das ordens.

create type location_kind as enum ('WAREHOUSE', 'PORT', 'INDUSTRY', 'TRANSSHIPMENT', 'OTHER');

create table locations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  kind location_kind not null default 'WAREHOUSE',
  name text not null check (length(trim(name)) between 2 and 160),
  code text check (code is null or length(code) <= 40),
  partner_id uuid references business_partners(id),
  zip_code text check (zip_code is null or zip_code ~ '^[0-9]{8}$'),
  address text check (address is null or length(address) <= 255),
  city text check (city is null or length(city) <= 120),
  state char(2),
  latitude numeric(9, 6) check (latitude is null or latitude between -90 and 90),
  longitude numeric(9, 6) check (longitude is null or longitude between -180 and 180),
  operating_hours text check (operating_hours is null or length(operating_hours) <= 200),
  receiving_instructions text check (receiving_instructions is null or length(receiving_instructions) <= 2000),
  contact_name text check (contact_name is null or length(contact_name) <= 120),
  contact_phone text check (contact_phone is null or contact_phone ~ '^[0-9]{10,13}$'),
  notes text check (notes is null or length(notes) <= 2000),
  status record_status not null default 'ACTIVE',
  archived_at timestamptz(6),
  created_by uuid references users(id),
  created_at timestamptz(6) not null default now(),
  updated_at timestamptz(6) not null
);

create unique index locations_tenant_code_key on locations (tenant_id, lower(code)) where code is not null;
create index locations_tenant_name_idx on locations (tenant_id, name);
create index locations_tenant_partner_idx on locations (tenant_id, partner_id);

-- Local vinculado a parceiro precisa ser do mesmo tenant.
create or replace function locations_partner_tenant() returns trigger language plpgsql as $$
begin
  if new.partner_id is not null and not exists (
    select 1 from business_partners p where p.id = new.partner_id and p.tenant_id = new.tenant_id
  ) then
    raise exception 'Parceiro do local pertence a outro tenant' using errcode = 'foreign_key_violation';
  end if;
  return new;
end $$;
create trigger locations_partner_tenant before insert or update on locations
  for each row execute function locations_partner_tenant();

alter table locations enable row level security;
alter table locations force row level security;

create policy tenant_isolation on locations as permissive for all
  using (tenant_id = app_tenant_id()) with check (tenant_id = app_tenant_id());

-- Matriz lê todos; organização externa lê só os locais do próprio parceiro (ex.: unidades do comprador).
create policy locations_scope_read on locations as restrictive for select
  using (
    app_is_internal()
    or exists (select 1 from organizations o where o.partner_id = locations.partner_id and o.id = any(app_org_ids()))
  );
create policy locations_scope_insert on locations as restrictive for insert
  with check (app_is_internal());
create policy locations_scope_update on locations as restrictive for update
  using (app_is_internal()) with check (app_is_internal());

grant select, insert, update on locations to ordens_app;
