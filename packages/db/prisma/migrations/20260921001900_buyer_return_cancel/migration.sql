-- Q41 (decidido): Faturamento devolve a solicitação ao Comprador com motivo; Comprador cancela com motivo
-- o próprio rascunho ou a solicitação enviada enquanto a fazenda ainda não foi definida (antes da análise).

alter table loading_orders
  add column returned_at timestamptz(6),
  add column returned_by uuid,
  add column return_reason text,
  add column cancelled_at timestamptz(6),
  add column cancelled_by uuid,
  add column cancel_reason text;

alter table loading_orders add constraint loading_orders_return_reason check (
  returned_at is null or (return_reason is not null and length(trim(return_reason)) >= 3)
);
alter table loading_orders add constraint loading_orders_cancel_reason check (
  cancelled_at is null or (cancel_reason is not null and length(trim(cancel_reason)) >= 3)
);

-- Fazenda: nada que não tenha sido publicado (solicitação cancelada antes da publicação nunca aparece, mesmo com
-- fazenda definida). Ordens publicadas existentes continuam visíveis independentemente de published_at.
drop policy orders_scope_read on loading_orders;
create policy orders_scope_read on loading_orders as restrictive for select
  using (
    app_is_internal()
    or (
      app_scope() = 'FARM' and status not in ('DRAFT', 'PENDING_BILLING')
      and not (status = 'CANCELLED' and origin = 'BUYER' and published_at is null)
      and farm_id is not null and seller_org_id = any(app_org_ids())
    )
    or (app_scope() = 'BUYER' and buyer_org_id = any(app_org_ids()) and (status <> 'DRAFT' or (origin = 'BUYER' and created_by = app_user_id())))
  );

-- Comprador: altera o próprio rascunho; na solicitação enviada, só cancela (regras finas no trigger).
drop policy orders_scope_update on loading_orders;
create policy orders_scope_update on loading_orders as restrictive for update
  using (
    app_is_internal()
    or (app_scope() = 'FARM' and seller_org_id = any(app_org_ids()))
    or (
      app_scope() = 'BUYER' and origin = 'BUYER' and status in ('DRAFT', 'PENDING_BILLING')
      and created_by = app_user_id() and buyer_org_id = any(app_org_ids())
    )
  )
  with check (
    app_is_internal()
    or (app_scope() = 'FARM' and seller_org_id = any(app_org_ids()))
    or (
      app_scope() = 'BUYER'
      and origin = 'BUYER'
      and status in ('DRAFT', 'PENDING_BILLING', 'CANCELLED')
      and created_by = app_user_id()
      and buyer_org_id = any(app_org_ids())
      and seller_partner_id is null and farm_id is null and contract_id is null
    )
  );

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
