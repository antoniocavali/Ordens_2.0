-- Captura de tela e imagens no chat de Atendimento.
--
-- O anexo é um file_upload comum (mesma quarentena, checksum, antivírus e promoção), mas com acesso
-- diferente do resto do sistema: documento de ordem é da organização, enquanto o print de uma conversa
-- é **do usuário que abriu a conversa**. Um colega da mesma empresa não vê o print de outro.

create table support_message_attachments (
  tenant_id       uuid not null,
  conversation_id uuid not null references support_conversations(id) on delete cascade,
  message_id      uuid not null references support_messages(id) on delete cascade,
  file_upload_id  uuid not null references file_uploads(id),
  created_by      uuid not null,
  created_at      timestamptz not null default now(),
  primary key (message_id, file_upload_id)
);

create index support_message_attachments_conversation_idx on support_message_attachments (tenant_id, conversation_id);
create unique index support_message_attachments_upload_idx on support_message_attachments (file_upload_id);

alter table support_message_attachments enable row level security;
alter table support_message_attachments force row level security;

create policy tenant_isolation on support_message_attachments as permissive for all
  using (tenant_id = app_tenant_id()) with check (tenant_id = app_tenant_id());

-- Mesma regra das mensagens: nota interna não chega a quem abriu a conversa.
create policy support_message_attachments_read on support_message_attachments as restrictive for select using (
  app_is_internal()
  or exists (
    select 1 from support_messages m
    join support_conversations c on c.id = m.conversation_id
    where m.id = message_id and not m.internal and c.requester_user_id = app_user_id()
  )
);

create policy support_message_attachments_insert on support_message_attachments as restrictive for insert with check (
  app_is_internal()
  or (
    created_by = app_user_id()
    and exists (
      select 1 from support_messages m
      join support_conversations c on c.id = m.conversation_id
      where m.id = message_id and not m.internal and c.requester_user_id = app_user_id()
    )
  )
);

-- ─── Arquivos do atendimento: acesso por usuário, não por organização ───
-- O ramo por organização continua valendo para todo o resto; para anexos de conversa, quem enxerga é
-- a Matriz (atendimento) e o próprio solicitante.
drop policy file_uploads_scope_read on file_uploads;
create policy file_uploads_scope_read on file_uploads as restrictive for select using (
  app_is_internal()
  or (entity_type <> 'support_conversation' and organization_id = any(app_org_ids()))
  or (
    entity_type = 'support_conversation'
    and exists (select 1 from support_conversations c where c.id = entity_id and c.requester_user_id = app_user_id())
  )
  or (app_scope() = 'FARM' and visibility in ('FARM', 'PARTIES') and seller_org_id = any(app_org_ids()))
  or (app_scope() = 'BUYER' and visibility in ('BUYER', 'PARTIES') and buyer_org_id = any(app_org_ids()))
);

-- Enviar o anexo depende de ter a conversa, não da permissão de documentos: Comprador e Transportadora
-- usam o chat sem nunca anexar nota fiscal. A gravação continua restrita a quem está enviando.
drop policy file_uploads_scope_insert on file_uploads;
create policy file_uploads_scope_insert on file_uploads as restrictive for insert with check (
  app_is_internal()
  or (
    created_by = app_user_id()
    and (
      organization_id = any(app_org_ids())
      or exists (select 1 from support_conversations c where c.id = entity_id and c.requester_user_id = app_user_id())
    )
  )
);

-- Retenção: o print pode conter o que estava aberto na tela de quem enviou. A varredura do worker
-- apaga o objeto no storage depois de 90 dias; o índice abaixo é o que ela percorre.
create index file_uploads_support_retention_idx on file_uploads (created_at)
  where entity_type = 'support_conversation' and status <> 'REMOVED';
