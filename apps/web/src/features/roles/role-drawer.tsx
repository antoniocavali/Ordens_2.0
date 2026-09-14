'use client';

import { CUSTOM_ROLE_SCOPES, PERMISSION_GROUPS, PERMISSIONS, permissionsAllowedForScope, type CustomRoleScope, type Permission, type RoleDto } from '@ordens/contracts';
import { Button, cn, Drawer, Field, Input, Select, Textarea } from '@ordens/ui';
import { Check, Lock } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { FormSection, span } from '@/features/registry/form-utils';
import { ORG_KIND_LABELS } from '@/features/users/roles';
import { useRoleMutations } from '@/features/users/users-api';
import { ApiRequestError } from '@/lib/api';

export type RoleDrawerState =
  | { mode: 'view'; role: RoleDto }
  | { mode: 'edit'; role: RoleDto }
  | { mode: 'create'; draft?: { name: string; description: string | null; scope: string; permissions: Permission[] } }
  | null;

type Errors = Partial<Record<'name' | 'scope' | 'permissions', string>>;

/** Criação, edição e consulta de papéis. Papéis do sistema são somente leitura (Q35). */
export function RoleDrawer({ state, onClose }: { state: RoleDrawerState; onClose: () => void }) {
  const { create, update } = useRoleMutations();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [scope, setScope] = useState<CustomRoleScope>('MATRIZ');
  const [selected, setSelected] = useState<Permission[]>([]);
  const [errors, setErrors] = useState<Errors>({});

  const readOnly = state?.mode === 'view';
  const role = state && state.mode !== 'create' ? state.role : null;
  const scopeLocked = state?.mode === 'edit' && (role?.membersCount ?? 0) > 0;

  useEffect(() => {
    if (!state) return;
    const source = state.mode === 'create' ? state.draft : state.role;
    setName(source?.name ?? '');
    setDescription(source?.description ?? '');
    setScope(((source?.scope as CustomRoleScope) ?? 'MATRIZ') as CustomRoleScope);
    setSelected(source?.permissions ? [...source.permissions] : []);
    setErrors({});
  }, [state]);

  const allowed = useMemo(() => new Set(permissionsAllowedForScope(scope)), [scope]);
  const groups = PERMISSION_GROUPS.map((g) => ({ ...g, permissions: g.permissions.filter((p) => readOnly || allowed.has(p)) })).filter((g) =>
    readOnly ? g.permissions.some((p) => selected.includes(p)) : g.permissions.length,
  );

  const toggle = (p: Permission, on: boolean) => setSelected((cur) => (on ? [...cur, p] : cur.filter((x) => x !== p)));
  const toggleGroup = (perms: Permission[], on: boolean) => setSelected((cur) => (on ? [...new Set([...cur, ...perms])] : cur.filter((x) => !perms.includes(x))));

  const submit = async () => {
    const next: Errors = {};
    if (name.trim().length < 3) next.name = 'Informe um nome com pelo menos 3 caracteres';
    const valid = selected.filter((p) => allowed.has(p));
    if (!valid.length) next.permissions = 'Selecione ao menos uma permissão';
    setErrors(next);
    if (Object.keys(next).length) return;
    const body = { name: name.trim(), description: description.trim() || null, scope, permissions: valid };
    try {
      if (state?.mode === 'edit' && role) {
        await update.mutateAsync({ id: role.id, ...body });
        toast.success(`Papel ${body.name} atualizado`);
      } else {
        await create.mutateAsync(body);
        toast.success(`Papel ${body.name} criado`);
      }
      onClose();
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setErrors({ name: err.fieldErrors.name?.[0], scope: err.fieldErrors.scope?.[0] });
        toast.error(err.message);
      } else toast.error('Não foi possível salvar o papel.');
    }
  };

  const title = state?.mode === 'create' ? 'Novo papel' : (role?.name ?? '');
  const selectedCount = selected.filter((p) => readOnly || allowed.has(p)).length;

  return (
    <Drawer
      open={Boolean(state)}
      onRequestClose={onClose}
      size="lg"
      title={title}
      subtitle={
        readOnly ? (
          <span className="inline-flex items-center gap-1.5">
            <Lock className="size-3.5" /> Papel do sistema: somente consulta. Para ajustar, duplique e edite a cópia.
          </span>
        ) : (
          'Escolha o que as pessoas com este papel podem fazer.'
        )
      }
      footer={
        readOnly ? (
          <div className="flex justify-end">
            <Button variant="ghost" onClick={onClose}>
              Fechar
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted tabular">{selectedCount} permissões selecionadas</span>
            <div className="ml-auto flex gap-2">
              <Button variant="ghost" onClick={onClose}>
                Cancelar
              </Button>
              <Button onClick={() => void submit()} loading={create.isPending || update.isPending}>
                <Check /> {state?.mode === 'edit' ? 'Salvar papel' : 'Criar papel'}
              </Button>
            </div>
          </div>
        )
      }
    >
      <FormSection title="Identificação">
        <Field label="Nome" required error={errors.name} className={span[4]}>
          {(a) => <Input {...a} value={name} onChange={(e) => setName(e.target.value)} disabled={readOnly} maxLength={60} />}
        </Field>
        <Field
          label="Tipo de organização"
          error={errors.scope}
          className={span[2]}
          hint={scopeLocked ? 'Papel já atribuído: tipo não pode mudar' : undefined}
        >
          {(a) => (
            <Select
              {...a}
              value={scope}
              disabled={readOnly || scopeLocked}
              onChange={(e) => setScope(e.target.value as CustomRoleScope)}
              options={CUSTOM_ROLE_SCOPES.map((s) => ({ value: s, label: ORG_KIND_LABELS[s] ?? s }))}
            />
          )}
        </Field>
        <Field label="Descrição" className={span[6]} hint="Opcional: aparece ao escolher o papel no convite e na edição de usuários">
          {(a) => <Textarea {...a} rows={2} value={description} onChange={(e) => setDescription(e.target.value)} disabled={readOnly} maxLength={200} />}
        </Field>
      </FormSection>

      <FormSection
        title="Permissões"
        description={readOnly ? undefined : `Só aparecem permissões disponíveis para ${ORG_KIND_LABELS[scope] ?? scope} (as mesmas que os papéis do sistema desse tipo já têm).`}
      >
        <div className="space-y-4 sm:col-span-6">
          {errors.permissions ? (
            <p role="alert" className="text-xs text-danger">
              {errors.permissions}
            </p>
          ) : null}
          {groups.map((g) => {
            const inGroup = g.permissions.filter((p) => selected.includes(p));
            const all = inGroup.length === g.permissions.length;
            return (
              <fieldset key={g.key} className="rounded-lg ring-1 ring-border">
                <legend className="sr-only">{g.label}</legend>
                <div className="flex items-center justify-between gap-3 border-b border-border/60 px-3 py-2">
                  <span className="text-sm font-semibold">{g.label}</span>
                  {!readOnly ? (
                    <button type="button" onClick={() => toggleGroup(g.permissions, !all)} className="text-xs font-medium text-primary hover:underline">
                      {all ? 'Limpar grupo' : 'Selecionar grupo'}
                    </button>
                  ) : (
                    <span className="text-xs text-subtle tabular">
                      {inGroup.length}/{g.permissions.length}
                    </span>
                  )}
                </div>
                <div className="grid gap-1 p-2 sm:grid-cols-2">
                  {g.permissions.map((p) => {
                    const checked = selected.includes(p);
                    if (readOnly && !checked) return null;
                    return (
                      <label key={p} className={cn('flex items-start gap-2.5 rounded-md px-2 py-1.5 text-sm', !readOnly && 'cursor-pointer hover:bg-surface-2')}>
                        <input
                          type="checkbox"
                          className="mt-0.5 size-4 accent-[var(--color-primary)]"
                          checked={checked}
                          disabled={readOnly}
                          onChange={(e) => toggle(p, e.target.checked)}
                        />
                        <span className="min-w-0">
                          <span className="block">{PERMISSIONS[p]}</span>
                          <span className="block font-mono text-[10.5px] text-subtle">{p}</span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>
            );
          })}
        </div>
      </FormSection>
    </Drawer>
  );
}
