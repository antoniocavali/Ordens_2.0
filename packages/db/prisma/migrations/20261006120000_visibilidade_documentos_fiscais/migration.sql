-- Acesso a documentos fiscais por parte (decisão de 06/10/2026):
--   Matriz    — tudo (como já era);
--   Fazenda   — só o que é dela: a nota que ela emite (PDF e XML) e o que ela mesma enviou;
--   Comprador — só o que a Matriz gerou para ele: a nota da Matriz (PDF e XML).
-- Até aqui as notas da carga nasciam visíveis "para todas as partes": o Comprador via a nota da
-- Fazenda e a Fazenda via a nota que a Matriz emite ao Comprador.

-- ─── NF-e: cada parte lê só as da própria origem ───

drop policy invoices_read on invoices;
create policy invoices_read on invoices as restrictive for select
  using (
    app_is_internal()
    or (app_scope() = 'FARM' and origin = 'FARM' and seller_org_id = any(app_org_ids()))
    or (app_scope() = 'BUYER' and origin = 'MATRIZ' and buyer_org_id = any(app_org_ids()) and status in ('VALID', 'DIVERGENT'))
  );

-- ─── Arquivos das notas já anexadas ───
-- A política de leitura de file_uploads já decide por `visibility`; o que muda é o valor gravado.
-- O ajuste roda como dono das tabelas, e FORCE RLS vale também para o dono: suspende em toda tabela
-- lida ou escrita e restaura ao final.

alter table file_uploads no force row level security;
alter table invoices no force row level security;
alter table organizations no force row level security;
alter table load_status_history no force row level security;

-- XML lido com sucesso: vale a origem que o emitente da nota determinou. O que não pôde ser lido
-- (sem emitente) não entra aqui — a origem gravada nesses casos era sempre "Matriz" — e segue a regra
-- de fase logo abaixo.
update file_uploads fu
  set visibility = case when i.origin = 'FARM' then 'FARM' else 'BUYER' end::document_visibility
  from invoices i
  where i.file_upload_id = fu.id and i.issuer_document is not null
    and fu.entity_type = 'load' and fu.kind = 'NFE_XML' and fu.visibility = 'PARTIES';

-- PDF (e XML que não chegou a virar nota): enviado pela Fazenda é dela; enviado pela Matriz é a nota
-- da Fazenda enquanto a carga não saiu para transporte, e a nota da Matriz depois disso — o mesmo
-- critério do checklist da nota da Matriz.
update file_uploads fu
  set visibility = case
    when exists (select 1 from organizations o where o.id = fu.organization_id and o.kind = 'FARM') then 'FARM'
    when fu.created_at >= (
      select min(h.occurred_at) from load_status_history h where h.load_id = fu.entity_id and h.to_status = 'IN_TRANSIT'
    ) then 'BUYER'
    else 'FARM'
  end::document_visibility
  where fu.entity_type = 'load' and fu.kind in ('PDF', 'NFE_XML') and fu.visibility = 'PARTIES';

-- XML ilegível anexado pela Matriz na fase da Fazenda estava registrado como origem "Matriz". Com a
-- leitura de NF-e agora separada por origem, a Fazenda deixaria de enxergar a rejeição de um arquivo
-- que é da documentação dela: a origem acompanha a visibilidade recém-definida do arquivo.
update invoices i
  set origin = 'FARM'
  from file_uploads fu
  where fu.id = i.file_upload_id and i.issuer_document is null and i.origin = 'MATRIZ' and fu.visibility = 'FARM';

alter table load_status_history force row level security;
alter table organizations force row level security;
alter table invoices force row level security;
alter table file_uploads force row level security;
