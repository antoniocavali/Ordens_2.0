-- Cancelamento de liberação (Q37): motivo obrigatório e coerência entre status e dados do cancelamento.

alter table loading_order_releases no force row level security;

alter table loading_order_releases add column cancel_reason text;

alter table loading_order_releases
  add constraint loading_order_releases_cancel_consistent check (
    (status = 'CANCELLED') = (cancelled_at is not null)
    and (status <> 'CANCELLED' or (cancel_reason is not null and length(trim(cancel_reason)) >= 3))
  );

-- Liberação cancelada não volta a valer, nem por bug na API.
create or replace function loading_order_releases_guard() returns trigger language plpgsql as $$
begin
  if old.status in ('CANCELLED', 'EXPIRED') and new.status <> old.status then
    raise exception 'Liberação encerrada não pode mudar de status' using errcode = 'check_violation';
  end if;
  if new.quantity <> old.quantity or new.order_id <> old.order_id or new.sequence <> old.sequence then
    raise exception 'Quantidade, ordem e sequência da liberação são imutáveis' using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger loading_order_releases_guard before update on loading_order_releases
  for each row execute function loading_order_releases_guard();

create index loading_order_releases_tenant_status_idx on loading_order_releases (tenant_id, status, created_at desc);

alter table loading_order_releases force row level security;
