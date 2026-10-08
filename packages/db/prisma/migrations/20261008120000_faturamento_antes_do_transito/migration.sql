-- Ordem das etapas da carga (08/10/2026): documentação da Fazenda validada → faturamento da Matriz →
-- liberação para trânsito, que conclui a carga. "Faturada pela Matriz" passa a acontecer ANTES de o
-- caminhão sair, então deixa de contar como carga que já seguiu para o destino: só as concluídas contam.
create or replace function recalc_order_quantities(p_order_id uuid) returns void
  language plpgsql as $$
begin
  update loading_orders lo set
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
      where l.order_id = lo.id and l.status in ('RECEIVED', 'CHECKED', 'AWAITING_MATRIZ_INVOICE', 'COMPLETED')
    ), 0),
    updated_at = now()
  where lo.id = p_order_id;
end $$;
