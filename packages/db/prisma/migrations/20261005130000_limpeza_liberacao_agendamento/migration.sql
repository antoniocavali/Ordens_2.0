-- Limpeza depois da remoção de liberações e agendamentos (Q50, 05/10/2026): somem as tabelas, os tipos
-- e as colunas que só existiam para eles. É definitivo — o histórico de liberações e agendamentos
-- deixa de existir no banco. A trilha de auditoria (audit_events) não é tocada.

-- ─── Funções que citavam as colunas removidas ───

-- Totais da ordem vêm só das cargas; "agendado" não existe mais.
create or replace function recalc_order_quantities(p_order_id uuid) returns void
  language plpgsql as $$
begin
  update loading_orders lo set
    loaded_qty = coalesce((
      select sum(coalesce(l.net_kg / nullif(u.factor_to_kg, 0), l.expected_qty)) from loads l
      left join units u on u.id = lo.unit_id
      where l.order_id = lo.id and l.status in ('LOADED', 'AWAITING_FARM_INVOICE', 'FARM_INVOICED', 'IN_TRANSIT', 'ARRIVED', 'RECEIVED', 'CHECKED', 'AWAITING_MATRIZ_INVOICE', 'MATRIZ_INVOICED', 'COMPLETED')
    ), 0),
    in_transit_qty = coalesce((
      select sum(coalesce(l.net_kg / nullif(u.factor_to_kg, 0), l.expected_qty)) from loads l
      left join units u on u.id = lo.unit_id
      where l.order_id = lo.id and l.status = 'IN_TRANSIT'
    ), 0),
    received_qty = coalesce((
      select sum(coalesce(l.received_qty, l.net_kg / nullif(u.factor_to_kg, 0), l.expected_qty)) from loads l
      left join units u on u.id = lo.unit_id
      where l.order_id = lo.id and l.status in ('RECEIVED', 'CHECKED', 'AWAITING_MATRIZ_INVOICE', 'MATRIZ_INVOICED', 'COMPLETED')
    ), 0),
    updated_at = now()
  where lo.id = p_order_id;
end $$;

create or replace function loading_orders_farm_guard() returns trigger
  language plpgsql as $$
begin
  if app_scope() = 'FARM' then
    -- Única mudança de status permitida à Fazenda: início da execução quando a primeira carga começa.
    if new.status is distinct from old.status and not (old.status = 'PUBLISHED' and new.status = 'IN_PROGRESS') then
      raise exception 'Fazenda não altera o status da ordem' using errcode = '42501';
    end if;
    if (new.tenant_id, new.number, new.version, new.quantity, new.cancelled_qty,
        new.seller_partner_id, new.farm_id, new.buyer_partner_id, new.commodity_id, new.contract_number, new.unit_id,
        new.unit_price, new.loading_starts_on, new.loading_ends_on, new.tolerance_pct, new.internal_notes,
        new.farm_notes, new.buyer_notes, new.published_at)
       is distinct from
       (old.tenant_id, old.number, old.version, old.quantity, old.cancelled_qty,
        old.seller_partner_id, old.farm_id, old.buyer_partner_id, old.commodity_id, old.contract_number, old.unit_id,
        old.unit_price, old.loading_starts_on, old.loading_ends_on, old.tolerance_pct, old.internal_notes,
        old.farm_notes, old.buyer_notes, old.published_at) then
      raise exception 'Fazenda só pode alterar totais operacionais da ordem' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

create or replace function loading_orders_buyer_guard() returns trigger
  language plpgsql as $$
begin
  if app_scope() <> 'BUYER' then
    return new;
  end if;
  if new.unit_price is not null or new.freight_estimate is not null or new.internal_notes is not null
     or new.farm_notes is not null or new.commercial_terms is not null or new.loading_instructions is not null
     or new.operation_type is not null
     or new.loaded_qty <> 0 or new.in_transit_qty <> 0
     or new.received_qty <> 0 or new.cancelled_qty <> 0 or new.tolerance_pct <> 0
     or new.version <> 0 or new.published_at is not null or new.publish_requested_at is not null then
    raise exception 'Comprador só informa os dados da própria solicitação' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' then
    -- Identificação e devolução são da Matriz.
    if (new.tenant_id, new.number, new.buyer_partner_id, new.created_by, new.origin, new.order_date, new.returned_at, new.returned_by, new.return_reason)
       is distinct from (old.tenant_id, old.number, old.buyer_partner_id, old.created_by, old.origin, old.order_date, old.returned_at, old.returned_by, old.return_reason) then
      raise exception 'Comprador não altera a identificação nem a devolução da solicitação' using errcode = '42501';
    end if;
    -- Solicitação enviada: o Comprador só cancela, e só antes da análise (fazenda ainda não definida).
    if old.status = 'PENDING_BILLING' then
      if new.status <> 'CANCELLED' or old.farm_id is not null or old.seller_partner_id is not null then
        raise exception 'Solicitação em análise pelo Faturamento: o Comprador só pode cancelar antes da definição da fazenda' using errcode = '42501';
      end if;
      if (new.commodity_id, new.quantity, new.unit_id, new.crop_year, new.loading_starts_on, new.loading_ends_on,
          new.destination_name, new.destination_address, new.destination_city, new.destination_state,
          new.freight_mode, new.preferred_carrier_id, new.buyer_notes, new.external_number, new.submitted_at, new.submitted_by)
         is distinct from
         (old.commodity_id, old.quantity, old.unit_id, old.crop_year, old.loading_starts_on, old.loading_ends_on,
          old.destination_name, old.destination_address, old.destination_city, old.destination_state,
          old.freight_mode, old.preferred_carrier_id, old.buyer_notes, old.external_number, old.submitted_at, old.submitted_by) then
        raise exception 'Solicitação enviada não pode ser alterada' using errcode = '42501';
      end if;
    end if;
    if new.status = 'CANCELLED' and (new.cancelled_by is distinct from app_user_id() or new.cancelled_at is null or new.cancel_reason is null) then
      raise exception 'Cancelamento deve registrar quem cancelou e o motivo' using errcode = '42501';
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

-- ─── Agendamentos ───

alter table loads drop constraint if exists loads_appointment_id_fkey;
alter table loads drop column if exists appointment_id;
drop table if exists appointments;
drop type if exists appointment_status;

-- ─── Liberações ───

drop table if exists loading_order_releases;
drop function if exists loading_order_releases_guard();
drop type if exists release_status;

alter table loading_orders
  drop column if exists released_qty,
  drop column if exists scheduled_qty,
  drop column if exists initial_release_qty;
