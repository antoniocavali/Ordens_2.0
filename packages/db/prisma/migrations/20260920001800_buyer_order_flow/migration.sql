-- Novo fluxo de ordens (Q41), parte 2.
-- 1) Comprador cria rascunho (origin = BUYER) e envia ao Faturamento (PENDING_BILLING); Faturamento define fazenda e publica.
-- 2) Carga: pesagem confirmada (LOADED) antes da documentação fiscal da Fazenda; transporte só com documentação validada.
-- Dados existentes preservados: ordens atuais seguem como origin = MATRIZ; cargas em andamento são reposicionadas
-- no novo fluxo com histórico e totais recalculados.

-- ─── Ordem: origem e envio ao Faturamento ───

alter table loading_orders
  add column origin order_origin not null default 'MATRIZ',
  add column submitted_at timestamptz(6),
  add column submitted_by uuid;

alter table loading_orders add constraint loading_orders_pending_billing_origin check (
  status <> 'PENDING_BILLING' or (origin = 'BUYER' and submitted_at is not null and submitted_by is not null)
);

create index loading_orders_pending_billing_idx on loading_orders (tenant_id, submitted_at) where status = 'PENDING_BILLING';
create index loading_orders_buyer_drafts_idx on loading_orders (tenant_id, created_by) where origin = 'BUYER' and status = 'DRAFT';

-- ─── RLS de ordens ───

drop policy orders_scope_read on loading_orders;
create policy orders_scope_read on loading_orders as restrictive for select
  using (
    app_is_internal()
    -- Fazenda: só ordens publicadas, com fazenda definida e da própria organização.
    or (app_scope() = 'FARM' and status not in ('DRAFT', 'PENDING_BILLING') and farm_id is not null and seller_org_id = any(app_org_ids()))
    -- Comprador: ordens da organização a partir do envio; rascunhos só os que ele mesmo criou pelo portal.
    or (app_scope() = 'BUYER' and buyer_org_id = any(app_org_ids()) and (status <> 'DRAFT' or (origin = 'BUYER' and created_by = app_user_id())))
  );

drop policy orders_scope_insert on loading_orders;
create policy orders_scope_insert on loading_orders as restrictive for insert
  with check (
    app_is_internal()
    or (
      app_scope() = 'BUYER'
      and origin = 'BUYER'
      and status = 'DRAFT'
      and created_by = app_user_id()
      and buyer_org_id = any(app_org_ids())
      and seller_partner_id is null and farm_id is null and contract_id is null
    )
  );

drop policy orders_scope_update on loading_orders;
create policy orders_scope_update on loading_orders as restrictive for update
  using (
    app_is_internal()
    or (app_scope() = 'FARM' and seller_org_id = any(app_org_ids()))
    or (app_scope() = 'BUYER' and origin = 'BUYER' and status = 'DRAFT' and created_by = app_user_id() and buyer_org_id = any(app_org_ids()))
  )
  with check (
    app_is_internal()
    or (app_scope() = 'FARM' and seller_org_id = any(app_org_ids()))
    or (
      app_scope() = 'BUYER'
      and origin = 'BUYER'
      and status in ('DRAFT', 'PENDING_BILLING')
      and created_by = app_user_id()
      and buyer_org_id = any(app_org_ids())
      and seller_partner_id is null and farm_id is null and contract_id is null
    )
  );

-- Comprador informa apenas os dados da própria solicitação: campos internos, totais, versão e publicação são da Matriz.
create or replace function loading_orders_buyer_guard() returns trigger
  language plpgsql as $$
begin
  if app_scope() <> 'BUYER' then
    return new;
  end if;
  if new.unit_price is not null or new.freight_estimate is not null or new.internal_notes is not null
     or new.farm_notes is not null or new.commercial_terms is not null or new.loading_instructions is not null
     or new.initial_release_qty is not null or new.operation_type is not null
     or new.released_qty <> 0 or new.scheduled_qty <> 0 or new.loaded_qty <> 0 or new.in_transit_qty <> 0
     or new.received_qty <> 0 or new.cancelled_qty <> 0 or new.tolerance_pct <> 0
     or new.version <> 0 or new.published_at is not null or new.publish_requested_at is not null then
    raise exception 'Comprador só informa os dados da própria solicitação' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' then
    if (new.tenant_id, new.number, new.buyer_partner_id, new.created_by, new.origin, new.order_date)
       is distinct from (old.tenant_id, old.number, old.buyer_partner_id, old.created_by, old.origin, old.order_date) then
      raise exception 'Comprador não altera a identificação da solicitação' using errcode = '42501';
    end if;
  end if;
  if new.status = 'PENDING_BILLING' and (new.submitted_by is distinct from app_user_id() or new.submitted_at is null) then
    raise exception 'Envio ao Faturamento deve registrar quem enviou' using errcode = '42501';
  end if;
  if new.status = 'DRAFT' and (new.submitted_at is not null or new.submitted_by is not null) then
    raise exception 'Rascunho não tem envio registrado' using errcode = '42501';
  end if;
  return new;
end $$;

create trigger loading_orders_buyer_guard before insert or update on loading_orders
  for each row execute function loading_orders_buyer_guard();

-- Comprador numera as próprias solicitações; demais sequências (contratos…) continuam da Matriz.
drop policy tenant_sequences_internal on tenant_sequences;
create policy tenant_sequences_internal on tenant_sequences as restrictive for all
  using (app_is_internal() or name in ('occurrence', 'support') or (app_scope() = 'BUYER' and name = 'loading_order'))
  with check (app_is_internal() or name in ('occurrence', 'support') or (app_scope() = 'BUYER' and name = 'loading_order'));

-- Comprador enxerga transportadoras para escolher a preferencial (a Fazenda já enxergava para agendar).
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
      app_scope() in ('FARM', 'BUYER')
      and exists (select 1 from partner_roles r where r.partner_id = business_partners.id and r.role = 'CARRIER')
    )
  );

-- ─── Carga: totais no novo fluxo ───
-- Agendado: até a confirmação do carregamento. Carregado: a partir da pesagem (inclui aguardando/validada documentação).

create or replace function recalc_order_quantities(p_order_id uuid) returns void
  language plpgsql security invoker as $$
begin
  update loading_orders lo set
    scheduled_qty = coalesce((
      select sum(a.expected_qty) from appointments a
      where a.order_id = lo.id and a.status in ('REQUESTED', 'CONFIRMED', 'CHECKED_IN')
    ), 0) + coalesce((
      select sum(l.expected_qty) from loads l
      where l.order_id = lo.id and l.status in ('SCHEDULED', 'CONFIRMED', 'AWAITING_LOADING', 'LOADING')
    ), 0),
    loaded_qty = coalesce((
      select sum(coalesce(l.net_kg / nullif(u.factor_to_kg, 0), l.expected_qty)) from loads l
      left join units u on u.id = lo.unit_id
      where l.order_id = lo.id and l.status in ('LOADED', 'AWAITING_FARM_INVOICE', 'FARM_INVOICED', 'IN_TRANSIT', 'ARRIVED', 'RECEIVED', 'CHECKED', 'AWAITING_MATRIZ_INVOICE', 'MATRIZ_INVOICED', 'COMPLETED')
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

-- ─── Carga: reposicionamento das cargas em andamento ───
-- Fluxo antigo: LOADING → AWAITING_FARM_INVOICE → FARM_INVOICED → LOADED (pesagem por último).
-- A migration roda como dono; FORCE RLS é suspenso só nesta transação para o reparo.

alter table loads no force row level security;
alter table load_status_history no force row level security;
alter table invoices no force row level security;
alter table loading_orders no force row level security;
alter table appointments no force row level security;
alter table units no force row level security;

-- Sem "on commit drop": o script de migration não roda numa única transação.
create temporary table load_flow_fix as
select l.id, l.tenant_id, l.order_id, l.status as old_status,
  (case
    when l.status in ('AWAITING_FARM_INVOICE', 'FARM_INVOICED') and (l.gross_kg is null or l.tare_kg is null) then 'LOADING'
    when l.status = 'LOADED' and exists (select 1 from invoices i where i.load_id = l.id and i.status in ('VALID', 'DIVERGENT')) then 'FARM_INVOICED'
    when l.status = 'LOADED' then 'AWAITING_FARM_INVOICE'
    else l.status::text
  end)::load_status as new_status
from loads l
where l.status in ('AWAITING_FARM_INVOICE', 'FARM_INVOICED', 'LOADED');

delete from load_flow_fix where new_status = old_status;

update loads l set
  status = f.new_status,
  loaded_at = case when f.new_status = 'LOADING' then null else coalesce(l.loaded_at, l.updated_at) end,
  updated_at = now()
from load_flow_fix f
where f.id = l.id;

insert into load_status_history (tenant_id, load_id, from_status, to_status, actor_user_id, notes)
select tenant_id, id, old_status, new_status, null,
  'Ajuste automático do novo fluxo: pesagem antes da documentação fiscal da Fazenda'
from load_flow_fix;

select recalc_order_quantities(o.order_id) from (select distinct order_id from loads) o;

drop table load_flow_fix;

alter table loads force row level security;
alter table load_status_history force row level security;
alter table invoices force row level security;
alter table loading_orders force row level security;
alter table appointments force row level security;
alter table units force row level security;
