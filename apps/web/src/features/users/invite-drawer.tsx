'use client';

import { Button, Drawer, Field, Input, Select } from '@ordens/ui';
import { Copy, Send, Sparkles, UserPlus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { FormSection, span } from '@/features/registry/form-utils';
import { ApiRequestError } from '@/lib/api';
import { useMe } from '@/lib/session';
import { RolePicker } from './role-picker';
import { ORG_KIND_LABELS, permissionsOf, splitRoleIds } from './roles';
import { generateTemporaryPassword, useOrganizations, useRoles, useUserMutations } from './users-api';

type Errors = Partial<Record<'name' | 'email' | 'organizationId' | 'roles' | 'temporaryPassword', string>>;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Novo acesso. `invite`: e-mail com link para definir a senha (72 h).
 * `create`: cria o usuário com senha provisória e troca obrigatória no primeiro acesso (Q36).
 */
export function InviteDrawer({ open, onClose, mode = 'invite' }: { open: boolean; onClose: () => void; mode?: 'invite' | 'create' }) {
  const orgs = useOrganizations();
  const roles = useRoles(open);
  const { invite, create } = useUserMutations();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [organizationId, setOrganizationId] = useState('');
  const [roleIds, setRoleIds] = useState<string[]>([]);
  const [temporaryPassword, setTemporaryPassword] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const creating = mode === 'create';

  const { data: me } = useMe();
  // Fora da Matriz só é possível dar acesso à própria organização (RLS de memberships).
  const ownOrgId = me?.activeMembership?.scope === 'MATRIZ' ? null : me?.activeMembership?.organization.id;
  const activeOrgs = (orgs.data ?? []).filter((o) => o.status === 'ACTIVE' && (!ownOrgId || o.id === ownOrgId));
  const org = activeOrgs.find((o) => o.id === organizationId);
  // Na criação direta, só papéis cujas permissões quem cria já tem (sem escalar privilégios) — a regra
  // vale dentro do próprio escopo: administrar grupos externos é função da Matriz, e os papéis deles
  // têm permissões que a Matriz não tem (painel do comprador, solicitar ordens...).
  const myPermissions = new Set(me?.permissions ?? []);
  const sameScope = Boolean(org) && org!.kind === me?.activeMembership?.scope;
  const assignable = creating && sameScope ? (roles.data ?? []).filter((r) => [...permissionsOf([r], [r.id])].every((p) => myPermissions.has(p))) : (roles.data ?? []);

  useEffect(() => {
    if (!open) return;
    setName('');
    setEmail('');
    setRoleIds([]);
    setTemporaryPassword(creating ? generateTemporaryPassword() : '');
    setErrors({});
    setOrganizationId(activeOrgs.length === 1 ? activeOrgs[0]!.id : '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, orgs.data]);

  const submit = async () => {
    const next: Errors = {};
    if (name.trim().length < 2) next.name = 'Informe o nome';
    if (!EMAIL.test(email.trim())) next.email = 'Informe um e-mail válido';
    if (!organizationId) next.organizationId = 'Selecione a organização';
    if (!roleIds.length) next.roles = 'Selecione ao menos um papel';
    if (creating && temporaryPassword.length < 12) next.temporaryPassword = 'A senha provisória deve ter pelo menos 12 caracteres';
    setErrors(next);
    if (Object.keys(next).length) return;
    const base = { name: name.trim(), email: email.trim().toLowerCase(), organizationId, ...splitRoleIds(roleIds) };
    try {
      if (creating) {
        await create.mutateAsync({ ...base, temporaryPassword });
        toast.success(`Usuário ${base.name} criado`, { description: 'Envie a senha provisória por um canal seguro. Ela será trocada no primeiro acesso.' });
      } else {
        const result = await invite.mutateAsync(base);
        toast.success(result.invited ? `Convite enviado para ${base.email}` : `${base.name} já tinha conta: acesso adicionado.`);
      }
      onClose();
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setErrors(Object.fromEntries(Object.entries(err.fieldErrors).map(([k, v]) => [k, v[0]])) as Errors);
        toast.error(err.message);
      } else toast.error(creating ? 'Não foi possível criar o usuário.' : 'Não foi possível enviar o convite.');
    }
  };

  return (
    <Drawer
      open={open}
      onRequestClose={onClose}
      size="md"
      title={creating ? 'Criar usuário' : 'Convidar usuário'}
      subtitle={
        creating
          ? 'Cria a conta com uma senha provisória. No primeiro acesso, a pessoa define a própria senha.'
          : 'A pessoa recebe um e-mail para definir a senha. Se já tiver conta, o acesso é adicionado.'
      }
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={() => void submit()} loading={invite.isPending || create.isPending}>
            {creating ? <UserPlus /> : <Send />} {creating ? 'Criar usuário' : 'Enviar convite'}
          </Button>
        </div>
      }
    >
      <FormSection title="Pessoa">
        <Field label="Nome" required error={errors.name} className={span[6]}>
          {(a) => <Input {...a} value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />}
        </Field>
        <Field label="E-mail" required error={errors.email} className={span[6]}>
          {(a) => <Input {...a} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" />}
        </Field>
        {creating ? (
          <Field label="Senha provisória" required error={errors.temporaryPassword} hint="Envie à pessoa por um canal seguro; ela não fica visível depois." className={span[6]}>
            {(a) => (
              <div className="flex items-center gap-2">
                <Input {...a} value={temporaryPassword} onChange={(e) => setTemporaryPassword(e.target.value)} autoComplete="off" spellCheck={false} className="font-mono" />
                <Button type="button" variant="ghost" size="sm" onClick={() => setTemporaryPassword(generateTemporaryPassword())}>
                  <Sparkles /> Gerar
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Copiar senha provisória"
                  disabled={!temporaryPassword}
                  onClick={() => {
                    void navigator.clipboard.writeText(temporaryPassword);
                    toast.success('Senha copiada');
                  }}
                >
                  <Copy />
                </Button>
              </div>
            )}
          </Field>
        ) : null}
      </FormSection>
      <FormSection
        title="Acesso"
        description={
          creating
            ? 'Papéis compatíveis com a organização, limitados às permissões que você já tem.'
            : 'Os papéis disponíveis dependem do tipo da organização, incluindo os papéis personalizados.'
        }
      >
        <Field label="Organização" required error={errors.organizationId} className={span[6]}>
          {(a) => (
            <Select
              {...a}
              value={organizationId}
              onChange={(e) => {
                setOrganizationId(e.target.value);
                setRoleIds([]);
              }}
              placeholder={orgs.isLoading ? 'Carregando…' : 'Selecione'}
              options={activeOrgs.map((o) => ({ value: o.id, label: `${o.name} · ${ORG_KIND_LABELS[o.kind] ?? o.kind}` }))}
            />
          )}
        </Field>
        <div className="sm:col-span-6">
          <RolePicker kind={org?.kind ?? ''} roles={assignable} value={roleIds} onChange={setRoleIds} error={errors.roles} />
        </div>
      </FormSection>
    </Drawer>
  );
}
