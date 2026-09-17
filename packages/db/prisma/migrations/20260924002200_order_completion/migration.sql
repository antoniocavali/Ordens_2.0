-- Conclusão da ordem (Q45): automática quando as cargas terminam e a quantidade é atingida,
-- ou manual pela Matriz (motivo obrigatório quando sobra saldo).
alter table loading_orders
  add column completed_at timestamptz(6),
  add column completed_by uuid,
  add column completion_reason text,
  add column completion_via text check (completion_via in ('auto', 'manual'));

-- Ordens já concluídas (demonstração/dados antigos) recebem a data de conclusão antes da restrição.
alter table loading_orders no force row level security;
update loading_orders set completed_at = coalesce(completed_at, updated_at), completion_via = coalesce(completion_via, 'auto') where status = 'COMPLETED';
alter table loading_orders force row level security;

alter table loading_orders add constraint loading_orders_completed_consistent check (
  status <> 'COMPLETED' or completed_at is not null
);
