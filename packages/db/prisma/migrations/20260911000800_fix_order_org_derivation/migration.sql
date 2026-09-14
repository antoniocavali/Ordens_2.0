-- Correção: o trigger de derivação da ordem recalculava seller_org_id/buyer_org_id em QUALQUER update.
-- Quando a Fazenda movimenta cargas, recalc_order_quantities atualiza a ordem sob o RLS da Fazenda, que não
-- enxerga a organização do Comprador; org_for_partner retornava NULL e o Comprador perdia a visibilidade.
-- Agora as organizações só são derivadas quando as partes (vendedor, comprador, fazenda, contrato) mudam.

create or replace function loading_orders_derive() returns trigger
  language plpgsql as $$
declare
  farm_owner uuid; farm_org uuid; farm_tenant uuid;
  c record;
begin
  if tg_op = 'UPDATE'
     and new.tenant_id = old.tenant_id
     and new.seller_partner_id is not distinct from old.seller_partner_id
     and new.buyer_partner_id is not distinct from old.buyer_partner_id
     and new.farm_id is not distinct from old.farm_id
     and new.contract_id is not distinct from old.contract_id then
    new.seller_org_id := old.seller_org_id;
    new.buyer_org_id := old.buyer_org_id;
    return new;
  end if;

  if new.farm_id is not null then
    select owner_partner_id, organization_id, tenant_id into farm_owner, farm_org, farm_tenant
      from farms where id = new.farm_id;
    if farm_tenant is null or farm_tenant <> new.tenant_id then
      raise exception 'Fazenda inexistente' using errcode = '23514', hint = 'INCONSISTENT_RELATION';
    end if;
    if new.seller_partner_id is null or farm_owner <> new.seller_partner_id then
      raise exception 'A fazenda não pertence ao vendedor informado' using errcode = '23514', hint = 'INCONSISTENT_RELATION';
    end if;
  end if;

  if new.contract_id is not null then
    select seller_partner_id, buyer_partner_id, commodity_id, tenant_id into c from contracts where id = new.contract_id;
    if c.tenant_id is null or c.tenant_id <> new.tenant_id then
      raise exception 'Contrato inexistente' using errcode = '23514', hint = 'INCONSISTENT_RELATION';
    end if;
    if (new.seller_partner_id is not null and new.seller_partner_id <> c.seller_partner_id)
       or (new.buyer_partner_id is not null and new.buyer_partner_id <> c.buyer_partner_id)
       or (new.commodity_id is not null and new.commodity_id <> c.commodity_id) then
      raise exception 'Vendedor, comprador ou commodity divergente do contrato' using errcode = '23514', hint = 'INCONSISTENT_RELATION';
    end if;
  end if;

  new.seller_org_id := case
    when new.seller_partner_id is null then null
    else coalesce(farm_org, org_for_partner(new.tenant_id, new.seller_partner_id, 'FARM'))
  end;
  new.buyer_org_id := case
    when new.buyer_partner_id is null then null
    else org_for_partner(new.tenant_id, new.buyer_partner_id, 'BUYER')
  end;
  return new;
end $$;

-- ─── Reparo de dados já afetados ───
-- A migration roda como dono das tabelas; FORCE RLS é suspenso só dentro desta transação para o reparo.

alter table loading_orders no force row level security;
alter table organizations no force row level security;
alter table farms no force row level security;
alter table loads no force row level security;
alter table appointments no force row level security;
alter table invoices no force row level security;
alter table occurrences no force row level security;
alter table file_uploads no force row level security;

-- Força a rederivação: atribuição à própria coluna de farm_id não muda valores, então recalcula explicitamente.
update loading_orders lo set
  seller_org_id = case when lo.seller_partner_id is null then null
    else coalesce((select f.organization_id from farms f where f.id = lo.farm_id), org_for_partner(lo.tenant_id, lo.seller_partner_id, 'FARM')) end,
  buyer_org_id = case when lo.buyer_partner_id is null then null
    else org_for_partner(lo.tenant_id, lo.buyer_partner_id, 'BUYER') end
where (lo.buyer_partner_id is not null and lo.buyer_org_id is null)
   or (lo.seller_partner_id is not null and lo.seller_org_id is null);

update loads l set seller_org_id = lo.seller_org_id, buyer_org_id = lo.buyer_org_id
  from loading_orders lo
  where lo.id = l.order_id and (l.seller_org_id, l.buyer_org_id) is distinct from (lo.seller_org_id, lo.buyer_org_id);

update appointments a set seller_org_id = lo.seller_org_id, buyer_org_id = lo.buyer_org_id
  from loading_orders lo
  where lo.id = a.order_id and (a.seller_org_id, a.buyer_org_id) is distinct from (lo.seller_org_id, lo.buyer_org_id);

update occurrences o set seller_org_id = lo.seller_org_id, buyer_org_id = lo.buyer_org_id
  from loading_orders lo
  where lo.id = o.order_id and (o.seller_org_id, o.buyer_org_id) is distinct from (lo.seller_org_id, lo.buyer_org_id);

update invoices i set seller_org_id = l.seller_org_id, buyer_org_id = l.buyer_org_id
  from loads l
  where l.id = i.load_id and (i.seller_org_id, i.buyer_org_id) is distinct from (l.seller_org_id, l.buyer_org_id);

update file_uploads fu set seller_org_id = src.seller_org_id, buyer_org_id = src.buyer_org_id
  from (
    select id, 'loading_order' as entity_type, seller_org_id, buyer_org_id from loading_orders
    union all select id, 'load', seller_org_id, buyer_org_id from loads
    union all select id, 'occurrence', seller_org_id, buyer_org_id from occurrences
  ) src
  where src.id = fu.entity_id and src.entity_type = fu.entity_type
    and (fu.seller_org_id, fu.buyer_org_id) is distinct from (src.seller_org_id, src.buyer_org_id);

alter table loading_orders force row level security;
alter table organizations force row level security;
alter table farms force row level security;
alter table loads force row level security;
alter table appointments force row level security;
alter table invoices force row level security;
alter table occurrences force row level security;
alter table file_uploads force row level security;
