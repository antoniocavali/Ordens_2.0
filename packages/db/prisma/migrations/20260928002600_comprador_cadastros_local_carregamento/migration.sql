-- 1) Comprador passa a enxergar transportadoras, motoristas e veículos (antes: só Matriz, Fazenda e
-- Transportadora). O Comprador acompanha o transporte das cargas dele e precisa reconhecer quem
-- está na estrada. Continua sem poder criar ou alterar: escrita segue restrita à Matriz.
do $$
declare t text;
begin
  foreach t in array array['carrier_profiles', 'drivers', 'vehicles'] loop
    execute format('drop policy carrier_scope_read on %I', t);
    execute format(
      'create policy carrier_scope_read on %I as restrictive for select
         using (app_scope() in (''MATRIZ'', ''SYSTEM'', ''FARM'', ''BUYER'', ''CARRIER''))', t);
  end loop;
end $$;

-- 2) Locais ganham a finalidade: entrega (destino), carregamento (origem) ou ambos. Os cadastros que
-- já existem são todos de destino — é assim que a tela os usava até agora.
alter table locations
  add column usage text not null default 'DELIVERY' check (usage in ('DELIVERY', 'LOADING', 'BOTH'));

create index locations_usage_idx on locations (tenant_id, usage) where archived_at is null;
