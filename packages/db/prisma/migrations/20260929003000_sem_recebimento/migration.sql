-- O recebimento no destino deixa de existir: do trânsito a carga vai direto ao faturamento da Matriz.
-- Os status ARRIVED, RECEIVED e CHECKED continuam no enum por causa do histórico, mas nenhuma carga
-- nova entra neles.
--
-- Cargas que estavam nessas etapas são levadas para o faturamento, com a passagem registrada no
-- histórico — senão ficariam paradas, sem botão que as mova.
-- A migration roda como dono, e FORCE RLS vale até para ele: suspendo só durante o reparo.

alter table loads no force row level security;
alter table load_status_history no force row level security;
alter table loading_orders no force row level security;

insert into load_status_history (tenant_id, load_id, from_status, to_status, actor_user_id, notes, occurred_at)
select l.tenant_id, l.id, l.status, 'AWAITING_MATRIZ_INVOICE', null,
  'Etapa de recebimento no destino removida do fluxo', now()
from loads l
where l.status in ('ARRIVED', 'RECEIVED', 'CHECKED');

update loads set status = 'AWAITING_MATRIZ_INVOICE', received_at = coalesce(received_at, now())
where status in ('ARRIVED', 'RECEIVED', 'CHECKED');

alter table loads force row level security;
alter table load_status_history force row level security;
alter table loading_orders force row level security;

-- Totais da ordem: sem a etapa, o "recebido" passa a contar a partir do faturamento da Matriz, usando
-- o peso líquido (nenhuma carga nova informa quantidade recebida).
create or replace function recalc_order_quantities(p_order_id uuid) returns void
  language plpgsql security invoker as $$
begin
  update loading_orders lo set
    scheduled_qty = coalesce((
      select sum(a.expected_qty) from appointments a
      where a.order_id = lo.id and a.status in ('REQUESTED', 'CONFIRMED', 'CHECKED_IN')
    ), 0) + coalesce((
      select sum(l.expected_qty) from loads l
      where l.order_id = lo.id and l.status in ('SCHEDULED', 'CONFIRMED', 'AWAITING_LOADING', 'LOADING')
    ), 0),
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

-- Recalcula as ordens afetadas pela mudança de etapa das cargas acima.
do $$
declare r record;
begin
  for r in select distinct order_id from loads where status = 'AWAITING_MATRIZ_INVOICE' loop
    perform recalc_order_quantities(r.order_id);
  end loop;
end $$;

-- A coluna requires_receipt não é mais lida por ninguém; o guarda que protegia a decisão da Matriz
-- deixa de ter sentido. A coluna fica no banco (histórico), sem trigger.
drop trigger if exists loading_orders_receipt_guard on loading_orders;
drop function if exists loading_orders_receipt_guard();
