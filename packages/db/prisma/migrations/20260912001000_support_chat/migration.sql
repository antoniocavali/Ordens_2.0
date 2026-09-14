-- Chat de atendimento com assistente de triagem (Faturamento / Suporte) e painel de demandas.
-- Regras provisórias: docs/decisions/open-questions.md (Q26–Q30).

create type support_queue as enum ('BILLING', 'SUPPORT');
create type support_status as enum ('BOT', 'WAITING', 'OPEN', 'PENDING_CUSTOMER', 'RESOLVED', 'CLOSED');
create type support_priority as enum ('LOW', 'NORMAL', 'HIGH', 'URGENT');
create type support_author as enum ('CUSTOMER', 'AGENT', 'BOT', 'SYSTEM');

create table support_conversations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  number text not null,
  requester_user_id uuid not null references users(id),
  requester_org_id uuid references organizations(id),
  queue support_queue,
  status support_status not null default 'BOT',
  priority support_priority not null default 'NORMAL',
  subject text check (subject is null or length(subject) <= 160),
  assignee_user_id uuid references users(id),
  order_id uuid references loading_orders(id),
  bot_state jsonb not null default '{}',
  last_message_at timestamptz(6) not null default now(),
  first_response_at timestamptz(6),
  queued_at timestamptz(6),
  resolved_at timestamptz(6),
  closed_at timestamptz(6),
  created_at timestamptz(6) not null default now(),
  updated_at timestamptz(6) not null,
  constraint support_queue_after_triage check (status in ('BOT', 'CLOSED') or queue is not null)
);
create unique index support_conversations_tenant_id_number_key on support_conversations (tenant_id, number);
create index support_conversations_queue_idx on support_conversations (tenant_id, status, queue, last_message_at desc);
create index support_conversations_requester_idx on support_conversations (tenant_id, requester_user_id, last_message_at desc);
create index support_conversations_assignee_idx on support_conversations (tenant_id, assignee_user_id);

create table support_messages (
  id uuid primary key default gen_random_uuid(),
  -- Ordem estável: mensagens da mesma transação (cliente + assistente) compartilham o mesmo now().
  seq bigint generated always as identity,
  tenant_id uuid not null references tenants(id),
  conversation_id uuid not null references support_conversations(id),
  author_type support_author not null,
  author_user_id uuid references users(id),
  body text not null check (length(body) between 1 and 4000),
  internal boolean not null default false,
  metadata jsonb not null default '{}',
  created_at timestamptz(6) not null default now(),
  constraint support_messages_author check (
    (author_type in ('CUSTOMER', 'AGENT') and author_user_id is not null)
    or (author_type in ('BOT', 'SYSTEM'))
  ),
  constraint support_messages_internal_by_agent check (not internal or author_type in ('AGENT', 'SYSTEM'))
);
create index support_messages_conversation_idx on support_messages (tenant_id, conversation_id, seq);

-- Histórico de conversa é append-only; conversas nunca são apagadas.
revoke update, delete, truncate on support_messages from ordens_app;
revoke delete, truncate on support_conversations from ordens_app;
create trigger support_messages_immutable before update or delete on support_messages
  for each row execute function audit_events_immutable();

-- Quem abriu a conversa (fora da Matriz) não altera responsável, prioridade, solicitante nem ordem,
-- e só move o status pelos caminhos do fluxo do cliente.
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
    or (old.status = 'RESOLVED' and new.status = 'WAITING')
    or (old.status <> 'CLOSED' and new.status = 'CLOSED')
  ) then
    raise exception 'Transição de status permitida apenas ao atendimento' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger support_conversations_customer_guard before update on support_conversations
  for each row execute function support_conversations_customer_guard();

-- ─── RLS ───

do $$
declare t text;
begin
  foreach t in array array['support_conversations', 'support_messages'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format(
      'create policy tenant_isolation on %I as permissive for all
         using (tenant_id = app_tenant_id()) with check (tenant_id = app_tenant_id())', t);
  end loop;
end $$;

-- Matriz (atendimento) vê todas as conversas do tenant; demais usuários apenas as que abriram.
create policy support_conversations_access on support_conversations as restrictive for all
  using (app_is_internal() or requester_user_id = app_user_id())
  with check (app_is_internal() or requester_user_id = app_user_id());

-- Notas internas nunca chegam a quem abriu a conversa.
create policy support_messages_read on support_messages as restrictive for select using (
  app_is_internal()
  or (not internal and exists (select 1 from support_conversations c where c.id = conversation_id and c.requester_user_id = app_user_id()))
);
-- Cliente grava as próprias mensagens e as respostas do assistente na própria conversa (mesma transação).
create policy support_messages_insert on support_messages as restrictive for insert with check (
  app_is_internal()
  or (
    not internal
    and ((author_type = 'CUSTOMER' and author_user_id = app_user_id()) or (author_type = 'BOT' and author_user_id is null))
    and exists (select 1 from support_conversations c where c.id = conversation_id and c.requester_user_id = app_user_id())
  )
);
