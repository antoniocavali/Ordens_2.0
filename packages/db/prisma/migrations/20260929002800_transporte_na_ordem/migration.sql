-- O transporte é digitado já na ordem: o Comprador informa transportadora, motorista e a composição
-- de veículos ao solicitar, e o agendamento nasce com esses dados (ainda corrigíveis na portaria,
-- porque o caminhão que chega nem sempre é o previsto).
--
-- `preferred_carrier_name` vira `carrier_name`: com o transporte digitado na ordem, não há mais uma
-- "transportadora preferencial" separada da transportadora informada.

alter table loading_orders rename column preferred_carrier_name to carrier_name;

alter table loading_orders
  add column driver_name text,
  add column driver_cpf text,
  add column driver_rg text,
  add column driver_phone text,
  add column driver_birth_date date,
  add column driver_cnh text,
  add column driver_cnh_category text,
  add column driver_cnh_expires_at date,
  add column driver_cnh_restrictions text,
  -- Mesmo formato de appointments/loads: [{ plate, description, type, axles, renavam }].
  add column vehicles jsonb not null default '[]'::jsonb;

-- Sugestões de digitação também a partir das ordens.
create index loading_orders_driver_cpf_idx on loading_orders (tenant_id, driver_cpf) where driver_cpf is not null;
create index loading_orders_carrier_name_idx on loading_orders (tenant_id, carrier_name) where carrier_name is not null;
