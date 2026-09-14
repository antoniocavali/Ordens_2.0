-- Correção: tenant_sequences só aceitava a Matriz. Fazenda/Comprador precisam numerar o que podem abrir:
-- ocorrências (Fase 8, Q14) e conversas de atendimento (Q26). As demais sequências (ordens, contratos…)
-- continuam exclusivas da Matriz.
drop policy tenant_sequences_internal on tenant_sequences;
create policy tenant_sequences_internal on tenant_sequences as restrictive for all
  using (app_is_internal() or name in ('occurrence', 'support'))
  with check (app_is_internal() or name in ('occurrence', 'support'));
