'use client';

import { CUSTOM_ROLE_SCOPES, type RoleDto } from '@ordens/contracts';
import { Badge, Button, Card, cn, EmptyState, Skeleton } from '@ordens/ui';
import { Archive, ArchiveRestore, Copy, Eye, KeyRound, Pencil, Plus, ShieldOff, Users } from 'lucide-react';
import { motion } from 'motion/react';
import { useState } from 'react';
import { toast } from 'sonner';
import { ORG_KIND_LABELS } from '@/features/users/roles';
import { useRoleMutations, useRoles } from '@/features/users/users-api';
import { ApiRequestError } from '@/lib/api';
import { useCan, useMe } from '@/lib/session';
import { RoleDrawer, type RoleDrawerState } from './role-drawer';

function RoleCard({ role, manage, onOpen, onDuplicate, onArchive, onRestore, busy }: { role: RoleDto; manage: boolean; onOpen: () => void; onDuplicate: () => void; onArchive: () => void; onRestore: () => void; busy: boolean }) {
  const archived = role.status === 'ARCHIVED';
  return (
    <Card className={cn('flex flex-col gap-3 p-4', archived && 'opacity-70')}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <h3 className="truncate font-semibold">{role.name}</h3>
            {role.system ? (
              <Badge size="sm" tone="neutral">
                Sistema
              </Badge>
            ) : (
              <Badge size="sm" tone="primary">
                Personalizado
              </Badge>
            )}
            {archived ? (
              <Badge size="sm" tone="warning">
                Arquivado
              </Badge>
            ) : null}
          </div>
          {role.description ? <p className="mt-1 line-clamp-2 text-xs text-muted">{role.description}</p> : null}
        </div>
      </div>
      <div className="flex items-center gap-4 text-xs text-muted">
        <span className="inline-flex items-center gap-1">
          <KeyRound className="size-3.5" /> {role.permissions.length} permissões
        </span>
        <span className="inline-flex items-center gap-1">
          <Users className="size-3.5" /> {role.membersCount} {role.membersCount === 1 ? 'pessoa' : 'pessoas'}
        </span>
      </div>
      <div className="mt-auto flex flex-wrap gap-1.5 border-t border-border/60 pt-3">
        <Button size="sm" variant="ghost" onClick={onOpen}>
          {role.system || !manage ? <Eye /> : <Pencil />} {role.system || !manage ? 'Ver permissões' : 'Editar'}
        </Button>
        {manage ? (
          <Button size="sm" variant="ghost" onClick={onDuplicate}>
            <Copy /> Duplicar
          </Button>
        ) : null}
        {manage && !role.system ? (
          archived ? (
            <Button size="sm" variant="ghost" onClick={onRestore} loading={busy}>
              <ArchiveRestore /> Restaurar
            </Button>
          ) : (
            <Button size="sm" variant="ghost" onClick={onArchive} loading={busy}>
              <Archive /> Arquivar
            </Button>
          )
        ) : null}
      </div>
    </Card>
  );
}

/** Papéis e permissões: consulta dos papéis do sistema e gestão dos papéis personalizados do tenant (Q35). */
export function RolesPage() {
  const can = useCan();
  const { data: me } = useMe();
  const manage = can('role.manage');
  const allowed = manage || can('user.read');
  const roles = useRoles(allowed);
  const { archive, restore } = useRoleMutations();
  const [scope, setScope] = useState<string>('MATRIZ');
  const [drawer, setDrawer] = useState<RoleDrawerState>(null);

  if (me && !allowed) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16">
        <EmptyState icon={<ShieldOff />} title="Sem acesso a papéis" description="Somente administradores gerenciam papéis e permissões." />
      </div>
    );
  }

  const list = (roles.data ?? []).filter((r) => r.scope === scope);
  const scopes = CUSTOM_ROLE_SCOPES.filter((s) => (roles.data ?? []).some((r) => r.scope === s) || manage);
  const run = (promise: Promise<unknown>, message: string) =>
    promise.then(() => toast.success(message)).catch((err) => toast.error(err instanceof ApiRequestError ? err.message : 'Não foi possível concluir.'));

  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-5 px-4 py-6 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <span className="grid size-11 place-items-center rounded-xl bg-primary-soft text-primary">
            <KeyRound className="size-5" />
          </span>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Papéis e permissões</h1>
            <p className="text-sm text-muted">Papéis do sistema são fixos. Crie papéis personalizados combinando as funcionalidades de cada tipo de organização.</p>
          </div>
        </div>
        {manage ? (
          <Button onClick={() => setDrawer({ mode: 'create', draft: { name: '', description: null, scope, permissions: [] } })}>
            <Plus /> Novo papel
          </Button>
        ) : null}
      </div>

      <div className="flex items-center gap-1 overflow-x-auto rounded-lg bg-surface p-1 ring-1 ring-border sm:w-fit" role="tablist" aria-label="Tipo de organização">
        {scopes.map((s) => {
          const n = (roles.data ?? []).filter((r) => r.scope === s && r.status === 'ACTIVE').length;
          return (
            <button
              key={s}
              role="tab"
              aria-selected={scope === s}
              onClick={() => setScope(s)}
              className={cn('relative h-8 shrink-0 rounded-md px-3 text-[13px] font-medium', scope === s ? 'text-primary' : 'text-muted hover:text-text')}
            >
              {scope === s ? <motion.span layoutId="roles-scope" className="absolute inset-0 rounded-md bg-primary-soft" /> : null}
              <span className="relative">
                {ORG_KIND_LABELS[s] ?? s} <span className="tabular text-subtle">{n}</span>
              </span>
            </button>
          );
        })}
      </div>

      {roles.isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-40 rounded-lg" />
          ))}
        </div>
      ) : !list.length ? (
        <EmptyState icon={<KeyRound />} title="Nenhum papel para este tipo" description={manage ? 'Crie um papel personalizado.' : undefined} />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {list.map((role) => (
            <RoleCard
              key={role.id}
              role={role}
              manage={manage}
              busy={(archive.isPending && archive.variables === role.id) || (restore.isPending && restore.variables === role.id)}
              onOpen={() => setDrawer({ mode: role.system || !manage ? 'view' : 'edit', role })}
              onDuplicate={() =>
                setDrawer({ mode: 'create', draft: { name: `${role.name} (cópia)`, description: role.description, scope: role.scope, permissions: role.permissions } })
              }
              onArchive={() => void run(archive.mutateAsync(role.id), `Papel ${role.name} arquivado`)}
              onRestore={() => void run(restore.mutateAsync(role.id), `Papel ${role.name} restaurado`)}
            />
          ))}
        </div>
      )}

      <RoleDrawer state={drawer} onClose={() => setDrawer(null)} />
    </div>
  );
}
