-- Relatórios em segundo plano: o pedido fica registrado e o worker gera o arquivo com o contexto
-- de RLS de quem pediu. O arquivo expira após a retenção (7 dias).
create table report_jobs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  membership_id uuid not null references memberships(id),
  requested_by uuid not null references users(id),
  kind text not null,
  format text not null check (format in ('csv', 'xlsx', 'pdf')),
  params jsonb not null default '{}',
  status text not null default 'PENDING' check (status in ('PENDING', 'RUNNING', 'DONE', 'FAILED', 'EXPIRED')),
  rows integer,
  total integer,
  truncated boolean not null default false,
  bucket text,
  object_key text,
  size_bytes bigint,
  error text,
  created_at timestamptz(6) not null default now(),
  started_at timestamptz(6),
  finished_at timestamptz(6),
  expires_at timestamptz(6),
  constraint report_jobs_done_has_file check (status <> 'DONE' or (object_key is not null and finished_at is not null))
);
create index report_jobs_user_recent on report_jobs (tenant_id, requested_by, created_at desc);
create index report_jobs_expiring on report_jobs (expires_at) where status = 'DONE';

alter table report_jobs enable row level security;
alter table report_jobs force row level security;

create policy tenant_isolation on report_jobs as permissive for all
  using (tenant_id = app_tenant_id()) with check (tenant_id = app_tenant_id());

-- Cada pessoa vê e pede só as próprias exportações; o worker (SYSTEM) processa e atualiza.
create policy report_jobs_owner on report_jobs as restrictive for all
  using (app_scope() = 'SYSTEM' or requested_by = app_user_id())
  with check (app_scope() = 'SYSTEM' or requested_by = app_user_id());

create policy report_jobs_system_updates on report_jobs as restrictive for update
  using (app_scope() = 'SYSTEM') with check (app_scope() = 'SYSTEM');

revoke delete on report_jobs from ordens_app;
