-- Transporte e local de carregamento deixam de depender de cadastro: transportadora, motorista,
-- veículos e o local passam a ser digitados no agendamento/ordem e copiados para a carga. A API
-- sugere o que já foi digitado antes no mesmo grupo, então não há cadastro para manter nem
-- retrabalho de digitação.
--
-- As tabelas de cadastro (drivers, vehicles, carrier_profiles, farms) continuam no banco nesta
-- etapa: os dados existentes são copiados para os novos campos e as tabelas ficam fora de uso, o
-- que permite voltar atrás. A remoção definitiva fica para uma limpeza posterior.

alter table appointments
  add column carrier_name text,
  add column driver_name text,
  add column driver_cpf text,
  add column driver_rg text,
  add column driver_phone text,
  add column driver_birth_date date,
  add column driver_cnh text,
  add column driver_cnh_category text,
  add column driver_cnh_expires_at date,
  add column driver_cnh_restrictions text,
  -- Composição do veículo: [{ plate, description, type, axles, renavam }] na ordem em que engata
  -- (cavalo, reboque, dolly, segundo reboque...), sem limite fixo de três posições.
  add column vehicles jsonb not null default '[]'::jsonb;

alter table loads
  add column carrier_name text,
  add column driver_name text,
  add column driver_cpf text,
  add column driver_rg text,
  add column driver_phone text,
  add column driver_birth_date date,
  add column driver_cnh text,
  add column driver_cnh_category text,
  add column driver_cnh_expires_at date,
  add column driver_cnh_restrictions text,
  add column vehicles jsonb not null default '[]'::jsonb;

-- Local de carregamento digitável na ordem, no mesmo formato do destino, e transportadora preferencial
-- deixando de ser um parceiro cadastrado.
alter table loading_orders
  add column loading_location_name text,
  add column loading_location_address text,
  add column loading_location_city text,
  add column loading_location_state char(2),
  add column preferred_carrier_name text;

-- ---------------------------------------------------------------------------
-- Cópia dos dados já cadastrados para os campos digitáveis (preserva histórico).
-- A migration roda como dono, e FORCE RLS vale até para ele: suspendo só durante a cópia.

alter table appointments no force row level security;
alter table loads no force row level security;
alter table loading_orders no force row level security;
alter table business_partners no force row level security;
alter table drivers no force row level security;
alter table vehicles no force row level security;
alter table farms no force row level security;

update appointments a set carrier_name = bp.legal_name
  from business_partners bp where bp.id = a.carrier_partner_id;
update loads l set carrier_name = bp.legal_name
  from business_partners bp where bp.id = l.carrier_partner_id;

update appointments a set
  driver_name = d.name, driver_cpf = d.cpf, driver_phone = d.phone,
  driver_cnh = d.cnh_number, driver_cnh_category = d.cnh_category, driver_cnh_expires_at = d.cnh_expires_at
  from drivers d where d.id = a.driver_id;
update loads l set
  driver_name = d.name, driver_cpf = d.cpf, driver_phone = d.phone,
  driver_cnh = d.cnh_number, driver_cnh_category = d.cnh_category, driver_cnh_expires_at = d.cnh_expires_at
  from drivers d where d.id = l.driver_id;

update loading_orders o set
  loading_location_name = f.name, loading_location_address = f.address,
  loading_location_city = f.city, loading_location_state = f.state
  from farms f where f.id = o.farm_id;

update loading_orders o set preferred_carrier_name = coalesce(bp.trade_name, bp.legal_name)
  from business_partners bp where bp.id = o.preferred_carrier_id;

-- Veículos: os três campos antigos viram a lista, na ordem cavalo → reboque → segundo reboque.
update appointments x set vehicles = src.list from (
  select a.id, jsonb_agg(
           jsonb_strip_nulls(jsonb_build_object(
             'plate', ve.plate, 'description', nullif(trim(concat_ws(' ', ve.brand, ve.model)), ''),
             'type', ve.type::text, 'axles', ve.axles, 'renavam', ve.renavam))
           order by s.ord) as list
    from appointments a
    cross join lateral (values (1, a.tractor_vehicle_id), (2, a.trailer_vehicle_id), (3, a.second_trailer_vehicle_id)) as s(ord, vehicle_id)
    join vehicles ve on ve.id = s.vehicle_id
    group by a.id
) src where src.id = x.id;

update loads x set vehicles = src.list from (
  select l.id, jsonb_agg(
           jsonb_strip_nulls(jsonb_build_object(
             'plate', ve.plate, 'description', nullif(trim(concat_ws(' ', ve.brand, ve.model)), ''),
             'type', ve.type::text, 'axles', ve.axles, 'renavam', ve.renavam))
           order by s.ord) as list
    from loads l
    cross join lateral (values (1, l.tractor_vehicle_id), (2, l.trailer_vehicle_id), (3, l.second_trailer_vehicle_id)) as s(ord, vehicle_id)
    join vehicles ve on ve.id = s.vehicle_id
    group by l.id
) src where src.id = x.id;

alter table appointments force row level security;
alter table loads force row level security;
alter table loading_orders force row level security;
alter table business_partners force row level security;
alter table drivers force row level security;
alter table vehicles force row level security;
alter table farms force row level security;

-- ---------------------------------------------------------------------------
-- Sugestões de digitação: o que este tenant/grupo já usou antes.

create index appointments_driver_cpf_idx on appointments (tenant_id, driver_cpf) where driver_cpf is not null;
create index appointments_carrier_name_idx on appointments (tenant_id, carrier_name) where carrier_name is not null;
create index loads_driver_cpf_idx on loads (tenant_id, driver_cpf) where driver_cpf is not null;
create index loading_orders_loading_location_idx on loading_orders (tenant_id, loading_location_name) where loading_location_name is not null;
