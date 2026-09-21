-- Cópia do XML da Fazenda em pasta de rede. A configuração é da empresa (Matriz) e o caminho pode
-- mudar a qualquer momento: as cópias pendentes passam a ir para o novo endereço.
create table xml_archive_settings (
  tenant_id uuid primary key references tenants(id),
  enabled boolean not null default false,
  -- Caminho UNC (\servidor\compartilhamento\pasta) ou pasta local/montada liberada no servidor.
  path text not null default '',
  domain text,
  username text,
  -- Senha cifrada (AES-256-GCM); nunca volta para a tela.
  password_enc bytea,
  -- Modelo das subpastas com marcadores ({ano}, {mes}, {dia}, {cnpj_emitente}, {tipo}...). Vazio = tudo na mesma pasta.
  folder_template text not null default '{ano}\{mes}',
  last_test_at timestamptz(6),
  last_test_ok boolean,
  last_test_message text,
  updated_by uuid references users(id),
  updated_at timestamptz(6) not null default now()
);

alter table xml_archive_settings enable row level security;
alter table xml_archive_settings force row level security;

create policy tenant_isolation on xml_archive_settings as permissive for all
  using (tenant_id = app_tenant_id()) with check (tenant_id = app_tenant_id());

-- Só a Matriz (e o worker) enxerga a configuração: contém credencial da rede da empresa.
create policy xml_archive_settings_matriz on xml_archive_settings as restrictive for all
  using (app_scope() in ('SYSTEM', 'MATRIZ')) with check (app_scope() in ('SYSTEM', 'MATRIZ'));

revoke delete on xml_archive_settings from ordens_app;

-- Situação da cópia em cada nota.
alter table invoices
  add column archived_at timestamptz(6),
  add column archive_path text,
  add column archive_error text,
  add column archive_attempts integer not null default 0;

create index invoices_archive_pending on invoices (tenant_id, created_at)
  where archived_at is null and origin = 'FARM' and status in ('VALID', 'DIVERGENT');
