-- Corrige recursão infinita de RLS: business_partners → partner_roles → business_partners.
-- partner_roles passa a ser isolada apenas por tenant na leitura (o papel de um parceiro invisível
-- não expõe dados). Escrita continua restrita à Matriz/sistema.

drop policy partner_roles_scope on partner_roles;

create policy partner_roles_scope_insert on partner_roles as restrictive for insert
  with check (app_is_internal());

create policy partner_roles_scope_update on partner_roles as restrictive for update
  using (app_is_internal()) with check (app_is_internal());

create policy partner_roles_scope_delete on partner_roles as restrictive for delete
  using (app_is_internal());
