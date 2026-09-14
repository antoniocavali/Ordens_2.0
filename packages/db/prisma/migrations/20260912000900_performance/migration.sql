-- Fase 10: desempenho. Medido com 14 mil ordens, 42 mil cargas e 127 mil eventos de histórico (docs/performance.md).

-- Momento de carregamento/recebimento na própria carga: a série diária do painel deixa de juntar o histórico
-- (cuja política RLS consulta loads por linha) e passa a usar índice direto.
alter table loads
  add column loaded_at timestamptz(6),
  add column received_at timestamptz(6);

-- Preenchimento a partir do histórico. A migration roda como dono das tabelas; FORCE RLS é suspenso só nesta transação.
alter table loads no force row level security;
alter table load_status_history no force row level security;
update loads l set
  loaded_at = (select min(h.occurred_at) from load_status_history h where h.tenant_id = l.tenant_id and h.load_id = l.id and h.to_status = 'LOADED'),
  received_at = (select min(h.occurred_at) from load_status_history h where h.tenant_id = l.tenant_id and h.load_id = l.id and h.to_status = 'RECEIVED');
alter table loads force row level security;
alter table load_status_history force row level security;

create index loads_tenant_id_loaded_at_idx on loads (tenant_id, loaded_at) where loaded_at is not null;
create index loads_tenant_id_received_at_idx on loads (tenant_id, received_at) where received_at is not null;
create index loads_tenant_id_created_at_idx on loads (tenant_id, created_at);

-- Recorte RLS de Fazenda/Comprador em listas de cargas e agendamentos.
create index loads_tenant_id_seller_org_id_idx on loads (tenant_id, seller_org_id);
create index loads_tenant_id_buyer_org_id_idx on loads (tenant_id, buyer_org_id);
create index appointments_tenant_id_seller_org_id_idx on appointments (tenant_id, seller_org_id);
create index appointments_tenant_id_buyer_org_id_idx on appointments (tenant_id, buyer_org_id);

-- Última visualização por lado (faróis da lista de ordens e do painel).
create index loading_order_views_order_side_version_idx on loading_order_views (order_id, side, version desc, last_viewed_at desc);

-- Central de documentos ordenada por data.
create index file_uploads_tenant_id_created_at_idx on file_uploads (tenant_id, created_at desc);
