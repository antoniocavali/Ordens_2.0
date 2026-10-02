-- Contrato deixa de ser cadastro: passa a ser uma referência comercial digitada pelo Faturamento na
-- hora de definir a fazenda. Some a tabela contracts (com o status e os gatilhos dela), some o
-- vínculo loading_orders.contract_id e, no lugar, a ordem guarda o número como texto.
--
-- Com isso saem também as regras que dependiam do cadastro: o bloqueio por saldo do contrato e a
-- conferência de vendedor/comprador/commodity contra ele. Decisão do cliente em 02/10/2026.

-- ─── Número do contrato na própria ordem ───

alter table loading_orders add column if not exists contract_number text;

-- O reparo de dados roda como dono das tabelas, e FORCE RLS vale também para o dono: suspende aqui,
-- restaura ao final. Vale para TODA tabela lida ou escrita — `contracts` entra porque é a origem do
-- número; sem ela o update enxerga zero linhas e a coluna nasce vazia, sem erro nenhum. `contracts`
-- não precisa ser restaurada: ela é removida no fim desta mesma migração.
alter table loading_orders no force row level security;
alter table contracts no force row level security;

update loading_orders lo
  set contract_number = c.number
  from contracts c
  where c.id = lo.contract_id;

-- Documentos presos a um contrato perdem o alvo: ficam marcados como removidos, com o motivo, e o
-- arquivo continua no bucket para quem precisar recuperar.
alter table file_uploads no force row level security;

update file_uploads
  set status = 'REMOVED',
      removed_at = now(),
      remove_reason = 'Cadastro de contratos removido da plataforma'
  where entity_type = 'contract' and status <> 'REMOVED';

alter table file_uploads force row level security;
alter table loading_orders force row level security;

-- As políticas do Comprador citam a coluna (ele não preenche contrato): refeitas sobre o texto.
drop policy if exists orders_scope_insert on loading_orders;
create policy orders_scope_insert on loading_orders as restrictive for insert
  with check (
    app_is_internal()
    or (
      app_scope() = 'BUYER'
      and origin = 'BUYER'
      and status = 'DRAFT'
      and created_by = app_user_id()
      and buyer_org_id = any(app_org_ids())
      and seller_partner_id is null and farm_id is null and contract_number is null
    )
  );

drop policy if exists orders_scope_update on loading_orders;
create policy orders_scope_update on loading_orders as restrictive for update
  using (
    app_is_internal()
    or (app_scope() = 'FARM' and seller_org_id = any(app_org_ids()))
    or (
      app_scope() = 'BUYER' and origin = 'BUYER' and status in ('DRAFT', 'PENDING_BILLING')
      and created_by = app_user_id() and buyer_org_id = any(app_org_ids())
    )
  )
  with check (
    app_is_internal()
    or (app_scope() = 'FARM' and seller_org_id = any(app_org_ids()))
    or (
      app_scope() = 'BUYER'
      and origin = 'BUYER'
      and status in ('DRAFT', 'PENDING_BILLING', 'CANCELLED')
      and created_by = app_user_id()
      and buyer_org_id = any(app_org_ids())
      and seller_partner_id is null and farm_id is null and contract_number is null
    )
  );

alter table loading_orders
  drop constraint loading_orders_contract_fk,
  drop column contract_id;

create index if not exists loading_orders_contract_number_idx on loading_orders (tenant_id, contract_number);

-- ─── Derivação da ordem sem o contrato ───

create or replace function loading_orders_derive() returns trigger
  language plpgsql as $$
declare
  farm_owner uuid; farm_org uuid; farm_tenant uuid;
begin
  if tg_op = 'UPDATE'
     and new.tenant_id = old.tenant_id
     and new.seller_partner_id is not distinct from old.seller_partner_id
     and new.buyer_partner_id is not distinct from old.buyer_partner_id
     and new.farm_id is not distinct from old.farm_id then
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

-- O guarda da Fazenda lista os campos que ela não pode mexer: o número do contrato entra no lugar
-- do antigo vínculo (a Fazenda segue alterando só os totais operacionais).
create or replace function loading_orders_farm_guard() returns trigger
  language plpgsql as $$
begin
  if app_scope() = 'FARM' then
    -- Única mudança de status permitida à Fazenda: início da execução quando a primeira carga começa.
    if new.status is distinct from old.status and not (old.status = 'PUBLISHED' and new.status = 'IN_PROGRESS') then
      raise exception 'Fazenda não altera o status da ordem' using errcode = '42501';
    end if;
    if (new.tenant_id, new.number, new.version, new.quantity, new.released_qty, new.cancelled_qty,
        new.seller_partner_id, new.farm_id, new.buyer_partner_id, new.commodity_id, new.contract_number, new.unit_id,
        new.unit_price, new.loading_starts_on, new.loading_ends_on, new.tolerance_pct, new.internal_notes,
        new.farm_notes, new.buyer_notes, new.published_at)
       is distinct from
       (old.tenant_id, old.number, old.version, old.quantity, old.released_qty, old.cancelled_qty,
        old.seller_partner_id, old.farm_id, old.buyer_partner_id, old.commodity_id, old.contract_number, old.unit_id,
        old.unit_price, old.loading_starts_on, old.loading_ends_on, old.tolerance_pct, old.internal_notes,
        old.farm_notes, old.buyer_notes, old.published_at) then
      raise exception 'Fazenda só pode alterar totais operacionais da ordem' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

-- ─── Fim do cadastro ───

drop trigger if exists contracts_derive on contracts;
drop function if exists contracts_derive();
drop table if exists contracts;
drop type if exists contract_status;

delete from tenant_sequences where name = 'contract';
