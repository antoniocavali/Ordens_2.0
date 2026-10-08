-- Exclusão de ordem pela Matriz (decisão de 08/10/2026): apaga a ordem e tudo o que nasceu dela —
-- cargas e histórico, notas fiscais, ocorrências, anexos, visualizações, versões e avisos.
--
-- O usuário da aplicação (ordens_app) continua SEM direito de DELETE em qualquer uma dessas tabelas.
-- A exclusão passa por uma única função, dona das tabelas, que só aceita o escopo Matriz e só enxerga
-- o tenant da sessão. Assim a regra "ninguém apaga carga, nota ou histórico avulso" segue valendo; o
-- que existe é apagar a ordem inteira, de uma vez, e isso fica na trilha de auditoria (gravada pela API
-- na mesma transação). A trilha de auditoria em si nunca é apagada.

-- ─── Histórico de status da carga: só-inserção, exceto dentro da exclusão da ordem ───
-- Tinha o mesmo gatilho genérico da auditoria. Ganha um próprio, que continua barrando UPDATE sempre e
-- DELETE fora da função abaixo (ela liga `app.deleting_order` só na própria transação). Ligar a
-- variável à mão não adianta: ordens_app não tem DELETE na tabela.
create or replace function load_status_history_immutable() returns trigger
  language plpgsql as $$
begin
  if tg_op = 'DELETE' and current_setting('app.deleting_order', true) = 'on' then
    return old;
  end if;
  raise exception 'load_status_history é append-only' using errcode = '42501';
end $$;

drop trigger load_status_history_immutable on load_status_history;
create trigger load_status_history_immutable before update or delete on load_status_history
  for each row execute function load_status_history_immutable();

-- ─── Exclusão da ordem ───
create or replace function delete_loading_order(p_order_id uuid) returns jsonb
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_scope text := app_scope();
  v_order loading_orders%rowtype;
  v_loads uuid[];
  v_occurrences uuid[];
  v_invoices uuid[];
  v_files jsonb;
  v_counts jsonb;
begin
  if v_scope <> 'MATRIZ' then
    raise exception 'Somente a Matriz exclui ordens' using errcode = '42501';
  end if;

  -- Trava a ordem; a política de tenant garante que só a do tenant da sessão é encontrada.
  select * into v_order from loading_orders where id = p_order_id for update;
  if not found then
    raise exception 'Ordem não encontrada' using errcode = 'P0002';
  end if;

  select coalesce(array_agg(id), '{}') into v_loads from loads where order_id = p_order_id;
  select coalesce(array_agg(id), '{}') into v_occurrences from occurrences where order_id = p_order_id;
  select coalesce(array_agg(id), '{}') into v_invoices from invoices where order_id = p_order_id;

  -- Os avisos são de cada usuário (a Matriz só enxerga os próprios). Daqui em diante a função age
  -- como sistema, dentro do mesmo tenant, para alcançar os de todos; o escopo é devolvido ao final.
  perform set_config('app.scope', 'SYSTEM', true);
  perform set_config('app.deleting_order', 'on', true);

  -- Arquivos no armazenamento: devolvidos a quem chamou, que os remove depois de a transação fechar.
  select coalesce(jsonb_agg(jsonb_build_object('bucket', bucket, 'key', object_key)), '[]'::jsonb) into v_files
    from file_uploads
    where (entity_type = 'loading_order' and entity_id = p_order_id)
       or (entity_type = 'load' and entity_id = any(v_loads))
       or (entity_type = 'occurrence' and entity_id = any(v_occurrences));

  v_counts := jsonb_build_object(
    'loads', cardinality(v_loads),
    'invoices', cardinality(v_invoices),
    'occurrences', cardinality(v_occurrences),
    'files', jsonb_array_length(v_files)
  );

  -- Conversas de atendimento continuam; só perdem o vínculo com a ordem.
  update support_conversations set order_id = null where order_id = p_order_id;

  delete from notifications
    where data ->> 'orderId' = p_order_id::text
       or (data ->> 'loadId') = any(select unnest(v_loads)::text)
       or (data ->> 'invoiceId') = any(select unnest(v_invoices)::text)
       or (data ->> 'occurrenceId') = any(select unnest(v_occurrences)::text);

  delete from invoices where order_id = p_order_id;
  delete from occurrences where order_id = p_order_id;
  delete from load_status_history where load_id = any(v_loads);
  delete from loads where order_id = p_order_id;
  delete from file_uploads
    where (entity_type = 'loading_order' and entity_id = p_order_id)
       or (entity_type = 'load' and entity_id = any(v_loads))
       or (entity_type = 'occurrence' and entity_id = any(v_occurrences));
  delete from loading_order_views where order_id = p_order_id;
  delete from loading_order_versions where order_id = p_order_id;
  delete from loading_orders where id = p_order_id;

  perform set_config('app.deleting_order', '', true);
  perform set_config('app.scope', v_scope, true);

  return jsonb_build_object('number', v_order.number, 'status', v_order.status::text, 'counts', v_counts, 'files', v_files);
end $$;

revoke all on function delete_loading_order(uuid) from public;
grant execute on function delete_loading_order(uuid) to ordens_app;
