'use client';

import type { UserListItem } from '@ordens/contracts';
import { Button, Drawer } from '@ordens/ui';
import { Check, Headphones, MailWarning, Power, RotateCcw, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { StatusPill } from '@/features/registry/registry-list';
import { FormSection, Stat } from '@/features/registry/form-utils';
import { ApiRequestError } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { useCan, useMe } from '@/lib/session';
import { RolePicker } from './role-picker';
import { canAttendWith, ORG_KIND_LABELS, roleName } from './roles';
import { useUserMutations } from './users-api';

const errorMessage = (err: unknown, fallback: string) => (err instanceof ApiRequestError ? err.message : fallback);

/** Detalhe de um acesso: papéis, status e convite. Alterações invalidam a sessão da pessoa na hora. */
export function UserDrawer({ user, onClose }: { user: UserListItem | null; onClose: () => void }) {
  const can = useCan();
  const { data: me } = useMe();
  const { update, resend } = useUserMutations();
  const [roles, setRoles] = useState<string[]>([]);
  const editable = can('user.manage');
  const isSelf = user?.userId === me?.user.id;

  useEffect(() => {
    setRoles(user?.roles ?? []);
  }, [user?.id, user?.roles]);

  if (!user) return null;

  const changed = roles.length !== user.roles.length || roles.some((r) => !user.roles.includes(r));
  const active = user.status === 'ACTIVE';

  const saveRoles = () =>
    update.mutate(
      { id: user.id, roles },
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
              <Button onClick={saveRoles} disabled={!changed || !roles.length} loading={update.isPending && update.variables?.roles !== undefined}>
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

      <FormSection
        title="Papéis"
        description={editable ? 'A mudança vale no próximo acesso da pessoa (sessões são revalidadas).' : 'Somente administradores alteram papéis.'}
      >
        <div className="sm:col-span-6">
          {editable ? (
            <RolePicker kind={user.scope} value={roles} onChange={setRoles} />
          ) : (
            <ul className="space-y-1 text-sm">
              {user.roles.map((r) => (
                <li key={r}>{roleName(r)}</li>
              ))}
            </ul>
          )}
        </div>
        {user.scope === 'MATRIZ' && canAttendWith(roles) && can('support.manage') ? (
          <div className="flex items-center gap-2 rounded-lg bg-surface-2 px-3 py-2.5 text-xs text-muted sm:col-span-6">
            <Headphones className="size-4 text-primary" />
            <span className="flex-1">Este papel permite atender no chat. As filas são definidas na equipe do atendimento.</span>
            <Link href="/atendimento/equipe" className="font-medium text-primary hover:underline">
              Abrir equipe
            </Link>
          </div>
        ) : null}
      </FormSection>

      <FormSection title="Segurança">
        <div className="flex items-center gap-2 text-sm sm:col-span-6">
          <ShieldCheck className={user.twoFactorEnabled ? 'size-4 text-success' : 'size-4 text-subtle'} />
          {user.twoFactorEnabled ? 'Verificação em duas etapas ativa' : 'Verificação em duas etapas não configurada'}
        </div>
      </FormSection>
    </Drawer>
  );
}
