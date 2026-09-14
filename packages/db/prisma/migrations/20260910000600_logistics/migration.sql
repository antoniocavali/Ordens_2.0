-- Fase 7: agendamentos, cargas e histórico de status.
-- Motorista, veículo e placas pertencem à CARGA (e ao agendamento), não à ordem.

create type appointment_status as enum ('REQUESTED', 'CONFIRMED', 'CHECKED_IN', 'CONVERTED', 'CANCELLED', 'NO_SHOW');
create type load_status as enum (
  'SCHEDULED', 'CONFIRMED', 'AWAITING_LOADING', 'LOADING', 'AWAITING_FARM_INVOICE', 'FARM_INVOICED', 'LOADED',
  'IN_TRANSIT', 'ARRIVED', 'RECEIVED', 'CHECKED', 'AWAITING_MATRIZ_INVOICE', 'MATRIZ_INVOICED', 'COMPLETED', 'CANCELLED'
);

create table appointments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  order_id uuid not null references loading_orders(id),
  seller_org_id uuid,
  buyer_org_id uuid,
  scheduled_on date not null,
  window_start text,
  window_end text,
  expected_qty numeric(18, 4) not null check (expected_qty > 0),
  carrier_partner_id uuid references business_partners(id),
  driver_id uuid references drivers(id),
  tractor_vehicle_id uuid references vehicles(id),
  trailer_vehicle_id uuid references vehicles(id),
  second_trailer_vehicle_id uuid references vehicles(id),
  plates text[] not null default '{}',
  status appointment_status not null default 'REQUESTED',
  notes text,
  cancel_reason text,
  created_by uuid,
  created_at timestamptz(6) not null default now(),
  updated_at timestamptz(6) not null
);
create index appointments_tenant_id_scheduled_on_idx on appointments (tenant_id, scheduled_on);
create index appointments_tenant_id_order_id_idx on appointments (tenant_id, order_id);
create index appointments_tenant_id_status_idx on appointments (tenant_id, status);

create table loads (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  order_id uuid not null references loading_orders(id),
  appointment_id uuid unique references appointments(id),
  seller_org_id uuid,
  buyer_org_id uuid,
  number text not null,
  sequence integer not null,
  loading_date date,
  expected_qty numeric(18, 4) not null check (expected_qty > 0),
  carrier_partner_id uuid references business_partners(id),
  driver_id uuid references drivers(id),
  tractor_vehicle_id uuid references vehicles(id),
  trailer_vehicle_id uuid references vehicles(id),
  second_trailer_vehicle_id uuid references vehicles(id),
  plates text[] not null default '{}',
  gross_kg numeric(18, 4) check (gross_kg is null or gross_kg >= 0),
  tare_kg numeric(18, 4) check (tare_kg is null or tare_kg >= 0),
  net_kg numeric(18, 4) check (net_kg is null or net_kg >= 0),
  invoiced_qty numeric(18, 4) check (invoiced_qty is null or invoiced_qty >= 0),
  received_qty numeric(18, 4) check (received_qty is null or received_qty >= 0),
  status load_status not null default 'SCHEDULED',
  notes text,
  created_by uuid,
  created_at timestamptz(6) not null default now(),
  updated_at timestamptz(6) not null,
  constraint loads_weights check (gross_kg is null or tare_kg is null or gross_kg >= tare_kg)
);
create unique index loads_order_id_sequence_key on loads (order_id, sequence);
create unique index loads_tenant_id_number_key on loads (tenant_id, number);
create index loads_tenant_id_status_idx on loads (tenant_id, status);
create index loads_tenant_id_loading_date_idx on loads (tenant_id, loading_date);
create index loads_plates_gin on loads using gin (plates);

create table load_status_history (
  id bigserial primary key,
  tenant_id uuid not null references tenants(id),
  load_id uuid not null references loads(id),
  from_status load_status,
  to_status load_status not null,
  actor_user_id uuid,
  notes text,
  occurred_at timestamptz(6) not null default now()
);
create index load_status_history_tenant_id_load_id_occurred_at_idx on load_status_history (tenant_id, load_id, occurred_at);

-- Histórico de status é append-only.
revoke update, delete, truncate on load_status_history from ordens_app;
create trigger load_status_history_immutable before update or delete on load_status_history
  for each row execute function audit_events_immutable();

-- Organizações herdadas da ordem (usadas pelo RLS) e mesmo tenant garantido.
create or replace function logistics_derive_orgs() returns trigger
  language plpgsql as $$
declare o record;
begin
  select tenant_id, seller_org_id, buyer_org_id into o from loading_orders where id = new.order_id;
  if o.tenant_id is null or o.tenant_id <> new.tenant_id then
    raise exception 'Ordem inexistente' using errcode = '23514', hint = 'INCONSISTENT_RELATION';
  end if;
  new.seller_org_id := o.seller_org_id;
  new.buyer_org_id := o.buyer_org_id;
  return new;
end $$;

create trigger appointments_derive_orgs before insert or update of order_id on appointments
  for each row execute function logistics_derive_orgs();
create trigger loads_derive_orgs before insert or update of order_id on loads
  for each row execute function logistics_derive_orgs();

-- RLS
do $$
declare t text;
begin
  foreach t in array array['appointments', 'loads', 'load_status_history'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format(
      'create policy tenant_isolation on %I as permissive for all
         using (tenant_id = app_tenant_id()) with check (tenant_id = app_tenant_id())', t);
  end loop;
end $$;

do $$
declare t text;
begin
  foreach t in array array['appointments', 'loads'] loop
    -- Leitura: Matriz; Fazenda da ordem; Comprador da ordem.
    execute format(
      'create policy logistics_read on %I as restrictive for select using (
         app_is_internal()
         or (app_scope() = ''FARM'' and seller_org_id = any(app_org_ids()))
         or (app_scope() = ''BUYER'' and buyer_org_id = any(app_org_ids()))
       )', t);
    -- Escrita: Matriz ou Fazenda da própria ordem (Comprador nunca).
    execute format(
      'create policy logistics_insert on %I as restrictive for insert with check (
         app_is_internal() or (app_scope() = ''FARM'' and seller_org_id = any(app_org_ids()))
       )', t);
    execute format(
      'create policy logistics_update on %I as restrictive for update
         using (app_is_internal() or (app_scope() = ''FARM'' and seller_org_id = any(app_org_ids())))
         with check (app_is_internal() or (app_scope() = ''FARM'' and seller_org_id = any(app_org_ids())))', t);
  end loop;
end $$;

create policy load_history_read on load_status_history as restrictive for select
  using (exists (select 1 from loads l where l.id = load_id));
create policy load_history_insert on load_status_history as restrictive for insert
  with check (exists (select 1 from loads l where l.id = load_id and (app_is_internal() or (app_scope() = 'FARM' and l.seller_org_id = any(app_org_ids())))));

-- Fazenda precisa atualizar os totais da própria ordem ao movimentar cargas: permitido apenas
-- via função que recalcula a partir dos filhos (nunca valores livres).
create or replace function recalc_order_quantities(p_order_id uuid) returns void
  language plpgsql security invoker as $$
begin
  update loading_orders lo set
    scheduled_qty = coalesce((
      select sum(a.expected_qty) from appointments a
      where a.order_id = lo.id and a.status in ('REQUESTED', 'CONFIRMED', 'CHECKED_IN')
    ), 0) + coalesce((
      select sum(l.expected_qty) from loads l
      where l.order_id = lo.id and l.status in ('SCHEDULED', 'CONFIRMED', 'AWAITING_LOADING', 'LOADING', 'AWAITING_FARM_INVOICE', 'FARM_INVOICED')
    ), 0),
    loaded_qty = coalesce((
      select sum(coalesce(l.net_kg / nullif(u.factor_to_kg, 0), l.expected_qty)) from loads l
      left join units u on u.id = lo.unit_id
      where l.order_id = lo.id and l.status in ('LOADED', 'IN_TRANSIT', 'ARRIVED', 'RECEIVED', 'CHECKED', 'AWAITING_MATRIZ_INVOICE', 'MATRIZ_INVOICED', 'COMPLETED')
    ), 0),
    in_transit_qty = coalesce((
      select sum(coalesce(l.net_kg / nullif(u.factor_to_kg, 0), l.expected_qty)) from loads l
      left join units u on u.id = lo.unit_id
      where l.order_id = lo.id and l.status in ('IN_TRANSIT', 'ARRIVED')
    ), 0),
    received_qty = coalesce((
      select sum(coalesce(l.received_qty, l.net_kg / nullif(u.factor_to_kg, 0), l.expected_qty)) from loads l
      left join units u on u.id = lo.unit_id
      where l.order_id = lo.id and l.status in ('RECEIVED', 'CHECKED', 'AWAITING_MATRIZ_INVOICE', 'MATRIZ_INVOICED', 'COMPLETED')
    ), 0),
    updated_at = now()
  where lo.id = p_order_id;
end $$;

-- A política de update de loading_orders só aceita Matriz. Para a Fazenda, a atualização de totais passa
-- por uma política adicional restrita às colunas de quantidade, verificada pelo trigger abaixo.
drop policy orders_scope_update on loading_orders;
create policy orders_scope_update on loading_orders as restrictive for update
  using (app_is_internal() or (app_scope() = 'FARM' and seller_org_id = any(app_org_ids())))
  with check (app_is_internal() or (app_scope() = 'FARM' and seller_org_id = any(app_org_ids())));

create or replace function loading_orders_farm_guard() returns trigger
  language plpgsql as $$
begin
  if app_scope() = 'FARM' then
    -- Única mudança de status permitida à Fazenda: início da execução quando a primeira carga começa.
    if new.status is distinct from old.status and not (old.status = 'PUBLISHED' and new.status = 'IN_PROGRESS') then
      raise exception 'Fazenda não altera o status da ordem' using errcode = '42501';
    end if;
    if (new.tenant_id, new.number, new.version, new.quantity, new.released_qty, new.cancelled_qty,
        new.seller_partner_id, new.farm_id, new.buyer_partner_id, new.commodity_id, new.contract_id, new.unit_id,
        new.unit_price, new.loading_starts_on, new.loading_ends_on, new.tolerance_pct, new.internal_notes,
        new.farm_notes, new.buyer_notes, new.published_at)
       is distinct from
       (old.tenant_id, old.number, old.version, old.quantity, old.released_qty, old.cancelled_qty,
        old.seller_partner_id, old.farm_id, old.buyer_partner_id, old.commodity_id, old.contract_id, old.unit_id,
        old.unit_price, old.loading_starts_on, old.loading_ends_on, old.tolerance_pct, old.internal_notes,
        old.farm_notes, old.buyer_notes, old.published_at) then
      raise exception 'Fazenda só pode alterar totais operacionais da ordem' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

create trigger loading_orders_farm_guard before update on loading_orders
  for each row execute function loading_orders_farm_guard();
