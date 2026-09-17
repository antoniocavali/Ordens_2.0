-- Recebimento no destino opcional por ordem: quando dispensado, a carga sai de "Em trânsito"
-- direto para o faturamento da Matriz (sem chegada, recebimento e conferência).
alter table loading_orders add column requires_receipt boolean not null default true;

-- Somente a Matriz decide se o recebimento é exigido (Fazenda e Comprador não alteram).
create or replace function loading_orders_receipt_guard() returns trigger
  language plpgsql as $$
begin
  if app_is_internal() then
    return new;
  end if;
  if (tg_op = 'INSERT' and not new.requires_receipt)
     or (tg_op = 'UPDATE' and new.requires_receipt is distinct from old.requires_receipt) then
    raise exception 'Somente a Matriz define se o recebimento no destino é exigido' using errcode = '42501';
  end if;
  return new;
end $$;

create trigger loading_orders_receipt_guard
  before insert or update of requires_receipt on loading_orders
  for each row execute function loading_orders_receipt_guard();
