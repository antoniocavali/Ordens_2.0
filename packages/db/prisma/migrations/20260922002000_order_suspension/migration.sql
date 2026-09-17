-- Suspensão, retomada e cancelamento de ordens pela Matriz (order.cancel), sempre com motivo.

alter table loading_orders
  add column suspended_at timestamptz(6),
  add column suspended_by uuid,
  add column suspend_reason text;

alter table loading_orders add constraint loading_orders_suspend_reason check (
  suspended_at is null or (suspend_reason is not null and length(trim(suspend_reason)) >= 3)
);
-- Ordem suspensa sempre sabe por quê (dados antigos não têm ordens suspensas sem motivo registrado a preservar:
-- as existentes recebem um motivo genérico).
alter table loading_orders no force row level security;
update loading_orders
  set suspended_at = coalesce(suspended_at, updated_at), suspend_reason = coalesce(suspend_reason, 'Suspensa antes do registro de motivo')
  where status = 'SUSPENDED';
alter table loading_orders force row level security;

alter table loading_orders add constraint loading_orders_suspended_consistent check (
  status <> 'SUSPENDED' or suspended_at is not null
);
