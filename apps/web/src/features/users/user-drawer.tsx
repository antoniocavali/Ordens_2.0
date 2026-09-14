'use client';

import type { UserListItem } from '@ordens/contracts';
import { Button, Drawer, Input } from '@ordens/ui';
import { Check, Copy, Headphones, KeyRound, MailWarning, Power, RotateCcw, ShieldCheck, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { StatusPill } from '@/features/registry/registry-list';
import { FormSection, Stat } from '@/features/registry/form-utils';
import { ApiRequestError } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { useCan, useMe } from '@/lib/session';
import { RolePicker } from './role-picker';
import { ORG_KIND_LABELS, permissionsOf, roleName, splitRoleIds } from './roles';
import { generateTemporaryPassword, useRoles, useUserMutations } from './users-api';

const errorMessage = (err: unknown, fallback: string) => (err instanceof ApiRequestError ? err.message : fallback);

/** Detalhe de um acesso: papéis, permissões individuais, senha provisória, status e convite. */
export function UserDrawer({ user, onClose }: { user: UserListItem | null; onClose: () => void }) {
  const can = useCan();
  const { data: me } = useMe();
  const roles = useRoles(Boolean(user));
  const { update, resend, grants, temporaryPassword } = useUserMutations();
  const [roleIds, setRoleIds] = useState<string[]>([]);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [tempPassword, setTempPassword] = useState('');
  const editable = can('user.manage');
  const isSelf = user?.userId === me?.user.id;

  useEffect(() => {
    setRoleIds(user ? [...user.roles, ...user.customRoles.map((c) => c.id)] : []);
    setPasswordOpen(false);
    setTempPassword('');
  }, [user?.id, user?.roles, user?.customRoles]);

  if (!user) return null;

  const initial = [...user.roles, ...user.customRoles.map((c) => c.id)];
  const changed = roleIds.length !== initial.length || roleIds.some((r) => !initial.includes(r));
  const active = user.status === 'ACTIVE';
  const rolePermissions = permissionsOf(roles.data ?? [], roleIds);
  const passwordByRole = rolePermissions.has('user.password.manage');
  const passwordGranted = user.grants.includes('user.password.manage');
  const canGrant = editable && user.scope === 'MATRIZ' && me?.activeMembership?.scope === 'MATRIZ' && !isSelf;
  const canSetPassword = can('user.password.manage') && !isSelf;

  const saveRoles = () =>
    update.mutate(
      { id: user.id, ...splitRoleIds(roleIds) },
      {
        onSuccess: () => toast.success('Papéis atualizados'),
        onError: (err) => toast.error(errorMessage(err, 'Não foi possível atualizar os papéis.')),
      },
    );
  const toggleStatus = () =>
    update.mutate(
      { id: user.id, status: active ? 'INACTIVE' : 'ACTIVE' },
      {
        onSuccess: () => {
          toast.success(active ? 'Acesso desativado' : 'Acesso reativado');
          onClose();
        },
        onError: (err) => toast.error(errorMessage(err, 'Não foi possível alterar o acesso.')),
      },
    );
  const resendInvite = () =>
    resend.mutate(user.id, {
      onSuccess: () => toast.success(`Convite reenviado para ${user.email}`),
      onError: (err) => toast.error(errorMessage(err, 'Não foi possível reenviar o convite.')),
    });
  const toggleGrant = () =>
    grants.mutate(
      { id: user.id, permissions: passwordGranted ? [] : ['user.password.manage'] },
      {
        onSuccess: () => toast.success(passwordGranted ? 'Permissão individual removida' : 'Permissão individual concedida'),
        onError: (err) => toast.error(errorMessage(err, 'Não foi possível alterar a permissão.')),
      },
    );
  const submitPassword = () =>
    temporaryPassword.mutate(
      { id: user.id, temporaryPassword: tempPassword },
      {
        onSuccess: () => {
          toast.success('Senha provisória definida', { description: 'As sessões da pessoa foram encerradas. Ela deverá criar uma nova senha no próximo acesso.' });
          setPasswordOpen(false);
          setTempPassword('');
        },
        onError: (err) => toast.error(err instanceof ApiRequestError ? (err.fieldErrors.temporaryPassword?.[0] ?? err.message) : 'Não foi possível definir a senha.'),
      },
    );

  return (
    <Drawer
      open
      onRequestClose={onClose}
      size="md"
      title={user.name}
      subtitle={
        <span className="flex flex-wrap items-center gap-2">
          {user.email}
          <StatusPill status={user.status} />
          {isSelf ? <span className="rounded-full bg-primary-soft px-2 text-[11px] font-medium text-primary">Você</span> : null}
        </span>
      }
      footer={
        editable ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="ghost" size="sm" onClick={toggleStatus} disabled={isSelf} loading={update.isPending && update.variables?.status !== undefined}>
              <Power /> {active ? 'Desativar acesso' : 'Reativar acesso'}
            </Button>
            <div className="ml-auto flex gap-2">
              <Button variant="ghost" onClick={onClose}>
                Fechar
              </Button>
              <Button onClick={saveRoles} disabled={!changed || !roleIds.length} loading={update.isPending && update.variables?.status === undefined}>
                <Check /> Salvar papéis
              </Button>
            </div>
          </div>
        ) : null
      }
    >
      <div className="grid grid-cols-2 gap-2 px-5 pt-5 sm:grid-cols-3 sm:px-7">
        <Stat label="Organização" value={`${user.organization.name}`} />
        <Stat label="Tipo" value={ORG_KIND_LABELS[user.organization.kind] ?? user.organization.kind} />
        <Stat label="Último acesso" value={user.lastLoginAt ? formatDateTime(user.lastLoginAt) : 'Nunca'} />
      </div>

      {user.invitePending ? (
        <div className="mx-5 mt-4 flex flex-wrap items-center gap-3 rounded-lg bg-warning-soft px-4 py-3 text-sm sm:mx-7">
          <MailWarning className="size-4 text-warning" />
          <span className="min-w-0 flex-1">Convite pendente: a pessoa ainda não definiu a senha. O link vale por 72 horas.</span>
          {editable ? (
            <Button size="sm" variant="outline" onClick={resendInvite} loading={resend.isPending} disabled={!active}>
              <RotateCcw /> Reenviar convite
            </Button>
          ) : null}
        </div>
      ) : null}
      {user.mustChangePassword ? (
        <div className="mx-5 mt-4 flex items-center gap-3 rounded-lg bg-info-soft px-4 py-3 text-sm text-info sm:mx-7">
          <KeyRound className="size-4" />
          Senha provisória definida: a pessoa vai criar uma nova senha no próximo acesso.
        </div>
      ) : null}

      <FormSection
        title="Papéis"
        description={editable ? 'Inclui os papéis personalizados do tipo da organização. A mudança vale na próxima requisição da pessoa.' : 'Somente administradores alteram papéis.'}
      >
        <div className="sm:col-span-6">
          {editable ? (
            <RolePicker kind={user.scope} roles={roles.data ?? []} value={roleIds} onChange={setRoleIds} />
          ) : (
            <ul className="space-y-1 text-sm">
              {user.roles.map((r) => (
                <li key={r}>{roleName(r)}</li>
              ))}
              {user.customRoles.map((c) => (
                <li key={c.id}>{c.name} (personalizado)</li>
              ))}
            </ul>
          )}
        </div>
        {user.scope === 'MATRIZ' && (rolePermissions.has('support.attend') || rolePermissions.has('support.manage')) && can('support.manage') ? (
          <div className="flex items-center gap-2 rounded-lg bg-surface-2 px-3 py-2.5 text-xs text-muted sm:col-span-6">
            <Headphones className="size-4 text-primary" />
            <span className="flex-1">Estes papéis permitem atender no chat. As filas são definidas na equipe do atendimento.</span>
            <Link href="/atendimento/equipe" className="font-medium text-primary hover:underline">
              Abrir equipe
            </Link>
          </div>
        ) : null}
      </FormSection>

      {canGrant ? (
        <FormSection title="Permissões individuais" description="Concedidas só para esta pessoa, além dos papéis.">
          <div className="flex items-start justify-between gap-4 rounded-lg px-3 py-2.5 ring-1 ring-border sm:col-span-6">
            <div className="min-w-0">
              <div className="text-sm font-medium">Pode definir senha provisória de outros usuários</div>
              <div className="text-xs text-muted">
                {passwordByRole ? 'Já incluída em um dos papéis desta pessoa.' : 'Permite redefinir senhas na tela de usuários (exceto de administradores).'}
                {!rolePermissions.has('user.read') ? ' Requer um papel com acesso à lista de usuários.' : ''}
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={passwordByRole || passwordGranted}
              aria-label="Pode definir senha provisória de outros usuários"
              disabled={passwordByRole || grants.isPending}
              onClick={toggleGrant}
              className={
                passwordByRole || passwordGranted
                  ? 'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full bg-primary transition disabled:opacity-60'
                  : 'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full bg-surface-3 ring-1 ring-border transition disabled:opacity-60'
              }
            >
              <span className={passwordByRole || passwordGranted ? 'inline-block size-4 translate-x-6 rounded-full bg-white shadow transition-transform' : 'inline-block size-4 translate-x-1 rounded-full bg-white shadow transition-transform'} />
            </button>
          </div>
        </FormSection>
      ) : null}

      {canSetPassword ? (
        <FormSection title="Senha" description="Defina uma senha provisória: as sessões da pessoa caem e ela cria uma nova senha no próximo acesso.">
          <div className="space-y-3 sm:col-span-6">
            {!passwordOpen ? (
              <Button variant="outline" size="sm" onClick={() => setPasswordOpen(true)} disabled={!active}>
                <KeyRound /> Definir senha provisória
              </Button>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="min-w-56 flex-1">
                    <Input
                      aria-label="Senha provisória"
                      value={tempPassword}
                      onChange={(e) => setTempPassword(e.target.value)}
                      autoComplete="off"
                      spellCheck={false}
                      className="font-mono"
                      placeholder="Mínimo de 12 caracteres"
                    />
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => setTempPassword(generateTemporaryPassword())}>
                    <Sparkles /> Gerar
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Copiar senha provisória"
                    disabled={!tempPassword}
                    onClick={() => {
                      void navigator.clipboard.writeText(tempPassword);
                      toast.success('Senha copiada');
                    }}
                  >
                    <Copy />
                  </Button>
                </div>
                <p className="text-xs text-subtle">Envie a senha à pessoa por um canal seguro. Ela não fica visível depois.</p>
                <div className="flex gap-2">
                  <Button size="sm" onClick={submitPassword} loading={temporaryPassword.isPending} disabled={tempPassword.length < 12}>
                    <ShieldCheck /> Confirmar senha provisória
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setPasswordOpen(false)}>
                    Cancelar
                  </Button>
                </div>
              </>
            )}
          </div>
        </FormSection>
      ) : null}

      <FormSection title="Segurança">
        <div className="flex items-center gap-2 text-sm sm:col-span-6">
          <ShieldCheck className={user.twoFactorEnabled ? 'size-4 text-success' : 'size-4 text-subtle'} />
          {user.twoFactorEnabled ? 'Verificação em duas etapas ativa' : 'Verificação em duas etapas não configurada'}
        </div>
      </FormSection>
    </Drawer>
  );
}
