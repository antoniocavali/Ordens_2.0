-- Fase 8: NF-e (XML), ocorrências e visibilidade de documentos para Fazenda/Comprador.
-- Regras provisórias documentadas em docs/decisions/open-questions.md (Q13–Q20).

create type invoice_origin as enum ('FARM', 'MATRIZ');
create type invoice_status as enum ('VALID', 'DIVERGENT', 'REJECTED', 'CANCELLED');
create type occurrence_type as enum ('WEIGHT_DIVERGENCE', 'QUALITY', 'DELAY', 'DOCUMENT', 'VEHICLE', 'ACCIDENT', 'OTHER');
create type occurrence_severity as enum ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');
create type occurrence_status as enum ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CANCELLED');
create type document_visibility as enum ('INTERNAL', 'FARM', 'BUYER', 'PARTIES');

-- ─── Documentos: visibilidade e organizações herdadas da entidade ───

alter table file_uploads
  add column visibility document_visibility not null default 'INTERNAL',
  add column seller_org_id uuid,
  add column buyer_org_id uuid;

-- ─── NF-e ───

create table invoices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  load_id uuid not null references loads(id),
  order_id uuid not null references loading_orders(id),
  seller_org_id uuid,
  buyer_org_id uuid,
  file_upload_id uuid unique references file_uploads(id),
  origin invoice_origin not null,
  status invoice_status not null default 'VALID',
  access_key char(44),
  number text,
  series text,
  issued_at timestamptz(6),
  issuer_document text,
  issuer_name text,
  recipient_document text,
  recipient_name text,
  total_value numeric(18, 2),
  net_weight_kg numeric(18, 4),
  gross_weight_kg numeric(18, 4),
  quantity numeric(18, 4),
  quantity_unit text,
  product_description text,
  plate text,
  protocol_status text,
  divergences jsonb not null default '[]',
  reject_reason text,
  cancel_reason text,
  created_by uuid,
  created_at timestamptz(6) not null default now(),
  updated_at timestamptz(6) not null,
  constraint invoices_identified check (status = 'REJECTED' or (access_key is not null and number is not null)),
  constraint invoices_access_key_format check (access_key is null or access_key ~ '^[0-9]{44}$')
);
-- Uma chave de acesso ativa por tenant (rejeitadas/canceladas não bloqueiam reenvio).
create unique index invoices_tenant_access_key_active on invoices (tenant_id, access_key)
  where status in ('VALID', 'DIVERGENT');
create index invoices_tenant_id_load_id_idx on invoices (tenant_id, load_id);
create index invoices_tenant_id_status_idx on invoices (tenant_id, status);
create index invoices_tenant_id_created_at_idx on invoices (tenant_id, created_at desc);

-- ─── Ocorrências ───

create table occurrences (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  order_id uuid not null references loading_orders(id),
  load_id uuid references loads(id),
  seller_org_id uuid,
  buyer_org_id uuid,
  number text not null,
  type occurrence_type not null,
  severity occurrence_severity not null default 'MEDIUM',
  status occurrence_status not null default 'OPEN',
  title text not null check (length(title) between 3 and 160),
  description text,
  visibility document_visibility not null default 'INTERNAL',
  responsible_user_id uuid references users(id),
  due_on date,
  resolution text,
  resolved_at timestamptz(6),
  resolved_by uuid,
  source text not null default 'MANUAL' check (source in ('MANUAL', 'SYSTEM')),
  created_by uuid,
  created_at timestamptz(6) not null default now(),
  updated_at timestamptz(6) not null,
  constraint occurrences_resolution check (status not in ('RESOLVED', 'CANCELLED') or resolution is not null)
);
create unique index occurrences_tenant_id_number_key on occurrences (tenant_id, number);
create index occurrences_tenant_id_status_idx on occurrences (tenant_id, status);
create index occurrences_tenant_id_order_id_idx on occurrences (tenant_id, order_id);
create index occurrences_tenant_id_load_id_idx on occurrences (tenant_id, load_id);

-- Documentos fiscais e ocorrências nunca são apagados (cancelamento é lógico).
revoke delete, truncate on invoices, occurrences from ordens_app;

-- ─── Derivações e consistência ───

create or replace function invoices_derive() returns trigger
  language plpgsql as $$
declare l record;
begin
  select tenant_id, order_id, seller_org_id, buyer_org_id into l from loads where id = new.load_id;
  if l.tenant_id is null or l.tenant_id <> new.tenant_id then
    raise exception 'Carga inexistente' using errcode = '23514', hint = 'INCONSISTENT_RELATION';
  end if;
  new.order_id := l.order_id;
  new.seller_org_id := l.seller_org_id;
  new.buyer_org_id := l.buyer_org_id;
  return new;
end $$;
create trigger invoices_derive before insert or update of load_id on invoices
  for each row execute function invoices_derive();

-- Ocorrência: carga (se houver) deve pertencer à ordem; organizações herdadas da ordem.
create or replace function occurrences_check_load() returns trigger
  language plpgsql as $$
begin
  if new.load_id is not null and not exists (select 1 from loads l where l.id = new.load_id and l.order_id = new.order_id) then
    raise exception 'Carga não pertence à ordem' using errcode = '23514', hint = 'INCONSISTENT_RELATION';
  end if;
  return new;
end $$;
create trigger occurrences_check_load before insert or update of load_id, order_id on occurrences
  for each row execute function occurrences_check_load();
create trigger occurrences_derive_orgs before insert or update of order_id on occurrences
  for each row execute function logistics_derive_orgs();

-- Upload herda as organizações da entidade à qual está vinculado (base da visibilidade externa).
create or replace function file_uploads_derive_orgs() returns trigger
  language plpgsql as $$
declare s uuid; b uuid;
begin
  if new.entity_type = 'loading_order' then
    select seller_org_id, buyer_org_id into s, b from loading_orders where id = new.entity_id;
  elsif new.entity_type = 'load' then
    select seller_org_id, buyer_org_id into s, b from loads where id = new.entity_id;
  elsif new.entity_type = 'occurrence' then
    select seller_org_id, buyer_org_id into s, b from occurrences where id = new.entity_id;
  end if;
  new.seller_org_id := s;
  new.buyer_org_id := b;
  return new;
end $$;
create trigger file_uploads_derive_orgs before insert on file_uploads
  for each row execute function file_uploads_derive_orgs();

-- Fazenda só cancela a própria NF-e; demais campos fiscais são imutáveis para ela.
create or replace function invoices_farm_guard() returns trigger
  language plpgsql as $$
begin
  if app_scope() = 'FARM' and (
    new.status <> 'CANCELLED'
    or new.access_key is distinct from old.access_key
    or new.load_id is distinct from old.load_id
    or new.origin is distinct from old.origin
    or new.number is distinct from old.number
    or new.divergences is distinct from old.divergences
  ) then
    raise exception 'Fazenda só pode cancelar a própria NF-e' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger invoices_farm_guard before update on invoices
  for each row execute function invoices_farm_guard();

-- Fazenda não encerra ocorrências (Q14).
create or replace function occurrences_farm_guard() returns trigger
  language plpgsql as $$
begin
  if app_scope() = 'FARM' and new.status is distinct from old.status and new.status in ('RESOLVED', 'CANCELLED') then
    raise exception 'Somente a Matriz encerra ocorrências' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger occurrences_farm_guard before update on occurrences
  for each row execute function occurrences_farm_guard();

-- ─── RLS ───

do $$
declare t text;
begin
  foreach t in array array['invoices', 'occurrences'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format(
      'create policy tenant_isolation on %I as permissive for all
         using (tenant_id = app_tenant_id()) with check (tenant_id = app_tenant_id())', t);
  end loop;
end $$;

-- NF-e: gravadas pelo worker (SYSTEM) ou Matriz; Fazenda lê e cancela as próprias; Comprador lê válidas.
create policy invoices_read on invoices as restrictive for select using (
  app_is_internal()
  or (app_scope() = 'FARM' and seller_org_id = any(app_org_ids()))
  or (app_scope() = 'BUYER' and buyer_org_id = any(app_org_ids()) and status in ('VALID', 'DIVERGENT'))
);
create policy invoices_insert on invoices as restrictive for insert with check (app_is_internal());
create policy invoices_update on invoices as restrictive for update
  using (app_is_internal() or (app_scope() = 'FARM' and seller_org_id = any(app_org_ids()) and origin = 'FARM'))
  with check (app_is_internal() or (app_scope() = 'FARM' and seller_org_id = any(app_org_ids()) and origin = 'FARM'));

-- Ocorrências: visibilidade explícita para Fazenda/Comprador.
create policy occurrences_read on occurrences as restrictive for select using (
  app_is_internal()
  or (app_scope() = 'FARM' and seller_org_id = any(app_org_ids()) and visibility in ('FARM', 'PARTIES'))
  or (app_scope() = 'BUYER' and buyer_org_id = any(app_org_ids()) and visibility in ('BUYER', 'PARTIES'))
);
create policy occurrences_insert on occurrences as restrictive for insert with check (
  app_is_internal()
  or (app_scope() = 'FARM' and seller_org_id = any(app_org_ids()) and visibility in ('FARM', 'PARTIES'))
);
create policy occurrences_update on occurrences as restrictive for update
  using (app_is_internal() or (app_scope() = 'FARM' and seller_org_id = any(app_org_ids()) and visibility in ('FARM', 'PARTIES')))
  with check (app_is_internal() or (app_scope() = 'FARM' and seller_org_id = any(app_org_ids()) and visibility in ('FARM', 'PARTIES')));

-- Documentos: além da própria organização, partes da ordem enxergam o que foi compartilhado com elas.
drop policy file_uploads_scope_read on file_uploads;
create policy file_uploads_scope_read on file_uploads as restrictive for select using (
  app_is_internal()
  or organization_id = any(app_org_ids())
  or (app_scope() = 'FARM' and visibility in ('FARM', 'PARTIES') and seller_org_id = any(app_org_ids()))
  or (app_scope() = 'BUYER' and visibility in ('BUYER', 'PARTIES') and buyer_org_id = any(app_org_ids()))
);
