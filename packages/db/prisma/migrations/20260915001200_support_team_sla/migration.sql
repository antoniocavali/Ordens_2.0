-- Equipe do atendimento configurável (Q31), SLA de 1ª resposta de 1 hora (Q30)
-- e conversa resolvida não reabre pelo cliente (Q29).

-- ─── Filas de cada atendente ───
-- Quem pode atender vem do papel (support.attend); em quais filas, desta tabela.
-- Supervisão (support.manage) atende todas as filas sem precisar de linha aqui.
create table support_queue_members (
  tenant_id uuid not null references tenants(id),
  membership_id uuid not null references memberships(id) on delete cascade,
  queue support_queue not null,
  created_by uuid references users(id),
  created_at timestamptz(6) not null default now(),
  primary key (membership_id, queue)
);
create index support_queue_members_tenant_idx on support_queue_members (tenant_id, queue);

-- Preserva o acesso atual: Operador nas duas filas; atendentes na própria fila.
-- membership_roles tem FORCE RLS: sem contexto de aplicação o SELECT volta vazio, então desliga
-- durante a migração de dados (religado abaixo, após a troca de papéis).
alter table membership_roles no force row level security;
insert into support_queue_members (tenant_id, membership_id, queue)
select mr.tenant_id, mr.membership_id, q.queue::support_queue
from membership_roles mr
join (values
  ('MATRIZ_OPERATOR', 'BILLING'),
  ('MATRIZ_OPERATOR', 'SUPPORT'),
  ('MATRIZ_BILLING_AGENT', 'BILLING'),
  ('MATRIZ_SUPPORT_AGENT', 'SUPPORT')
) as q(role_code, queue) on q.role_code = mr.role_code
on conflict do nothing;

grant delete on support_queue_members to ordens_app;
alter table support_queue_members enable row level security;
alter table support_queue_members force row level security;
create policy tenant_isolation on support_queue_members as permissive for all
  using (tenant_id = app_tenant_id()) with check (tenant_id = app_tenant_id());
create policy support_queue_members_internal on support_queue_members as restrictive for all
  using (app_is_internal()) with check (app_is_internal());

-- Papel único "Atendente": as filas passam a ser definidas na equipe.
update membership_roles set role_code = 'MATRIZ_SUPPORT_AGENT'
where role_code = 'MATRIZ_BILLING_AGENT'
  and not exists (
    select 1 from membership_roles x where x.membership_id = membership_roles.membership_id and x.role_code = 'MATRIZ_SUPPORT_AGENT'
  );
delete from membership_roles where role_code = 'MATRIZ_BILLING_AGENT';
alter table membership_roles force row level security;
delete from role_permissions where role_code = 'MATRIZ_BILLING_AGENT' or permission_code in ('support.billing', 'support.support');
delete from roles where code = 'MATRIZ_BILLING_AGENT';
delete from permissions where code in ('support.billing', 'support.support');

-- ─── SLA ───
-- Marca o aviso de SLA estourado; nova entrada na fila (queued_at posterior) permite novo aviso.
alter table support_conversations add column sla_notified_at timestamptz(6);
create index support_conversations_sla_idx on support_conversations (tenant_id, queued_at) where status = 'WAITING';

-- ─── Sem reabertura pelo cliente ───
create or replace function support_conversations_customer_guard() returns trigger
  language plpgsql as $$
begin
  if app_is_internal() then
    return new;
  end if;
  if new.assignee_user_id is distinct from old.assignee_user_id
     or new.priority is distinct from old.priority
     or new.requester_user_id is distinct from old.requester_user_id
     or new.requester_org_id is distinct from old.requester_org_id
     or new.number is distinct from old.number
     or new.first_response_at is distinct from old.first_response_at
     or (old.queue is not null and new.queue is distinct from old.queue)
     or (old.order_id is not null and new.order_id is distinct from old.order_id) then
    raise exception 'Alteração permitida apenas ao atendimento' using errcode = '42501';
  end if;
  if new.status is distinct from old.status and not (
       (old.status = 'BOT' and new.status = 'WAITING')
    or (old.status = 'PENDING_CUSTOMER' and new.status = 'OPEN')
    or (old.status <> 'CLOSED' and new.status = 'CLOSED')
  ) then
    raise exception 'Transição de status permitida apenas ao atendimento' using errcode = '42501';
  end if;
  return new;
end $$;
