-- Fluxo de publicação (Q40): solicitação de publicação e dupla checagem configurável por empresa.

alter table tenants
  add column publish_four_eyes boolean not null default false,
  add column publish_four_eyes_min_t numeric(18, 3) check (publish_four_eyes_min_t is null or publish_four_eyes_min_t > 0);

alter table loading_orders
  add column publish_requested_at timestamptz(6),
  add column publish_requested_by uuid references users(id);

-- Solicitação só faz sentido em rascunho; ao publicar, o registro da solicitação permanece como histórico.
alter table loading_orders
  add constraint loading_orders_publish_request_consistent check (
    (publish_requested_at is null) = (publish_requested_by is null)
  );

create index loading_orders_publish_requested_idx on loading_orders (tenant_id, publish_requested_at)
  where status = 'DRAFT' and publish_requested_at is not null;
