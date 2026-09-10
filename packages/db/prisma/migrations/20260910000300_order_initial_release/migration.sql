-- Liberação inicial preservada no rascunho e flag de 2FA legível por administradores.
alter table loading_orders add column initial_release_qty numeric(18, 4);
alter table loading_orders add constraint loading_orders_initial_release_positive
  check (initial_release_qty is null or initial_release_qty > 0);

alter table users add column two_factor_enabled boolean not null default false;
