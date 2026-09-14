'use client';

import type { UserListItem } from '@ordens/contracts';
import { Badge, Button, Card, cn, EmptyState, Input, Select, Skeleton } from '@ordens/ui';
import { ChevronLeft, ChevronRight, MailWarning, Search, ShieldCheck, UserPlus, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { StatusPill } from '@/features/registry/registry-list';
import { formatRelative } from '@/lib/format';
import { useCan, useMe } from '@/lib/session';
import { InviteDrawer } from './invite-drawer';
import { ORG_KIND_LABELS, roleName } from './roles';
import { UserDrawer } from './user-drawer';
import { useOrganizations, useUsers } from './users-api';

const PAGE_SIZE = 50;

function PersonCell({ u, self }: { u: UserListItem; self: boolean }) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1.5 truncate font-medium">
        {u.name}
        {self ? <span className="rounded-full bg-primary-soft px-1.5 text-[10.5px] font-medium text-primary">Você</span> : null}
      </div>
      <div className="truncate text-xs text-subtle">{u.email}</div>
      {u.invitePending ? (
        <span className="mt-0.5 inline-flex items-center gap-1 text-[11px] font-medium text-warning">
          <MailWarning className="size-3" /> Convite pendente
        </span>
      ) : null}
    </div>
  );
}

/** Gestão de usuários: acessos por organização, papéis, convites e ativação. */
export function UsersPage() {
  const can = useCan();
  const { data: me } = useMe();
  const orgs = useOrganizations();
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [organizationId, setOrganizationId] = useState('');
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);
  const [inviting, setInviting] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => {
      setQ(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const list = useUsers({ page, pageSize: PAGE_SIZE, q: q || undefined, status: status || undefined, organizationId: organizationId || undefined });
  const items = list.data?.items ?? [];
  const total = list.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  // Mantém o drawer com os dados atualizados após salvar (a lista é revalidada).
  const open = items.find((u) => u.id === openId) ?? null;

  return (
    <div className="mx-auto flex max-w-[1600px] flex-col gap-5 px-4 py-6 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <span className="grid size-11 place-items-center rounded-xl bg-primary-soft text-primary">
            <Users className="size-5" />
          </span>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Usuários</h1>
            <p className="text-sm text-muted">Quem tem acesso, em qual organização, com quais papéis — e convites pendentes.</p>
          </div>
        </div>
        {can('user.manage') ? (
          <Button onClick={() => setInviting(true)}>
            <UserPlus /> Convidar usuário
          </Button>
        ) : null}
      </div>

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-border/70 p-3">
          <div className="relative min-w-56 flex-1 sm:max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Nome ou e-mail…" className="pl-9" aria-label="Buscar usuários" />
          </div>
          <Select
            aria-label="Organização"
            value={organizationId}
            onChange={(e) => {
              setOrganizationId(e.target.value);
              setPage(1);
            }}
            placeholder="Todas as organizações"
            options={(orgs.data ?? []).map((o) => ({ value: o.id, label: `${o.name} · ${ORG_KIND_LABELS[o.kind] ?? o.kind}` }))}
            className="w-64"
          />
          <Select
            aria-label="Status"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
            placeholder="Todos os status"
            options={[
              { value: 'ACTIVE', label: 'Ativos' },
              { value: 'INACTIVE', label: 'Inativos' },
            ]}
            className="w-40"
          />
          <span className="ml-auto text-xs text-subtle tabular" aria-live="polite">
            {list.isFetching ? 'Atualizando…' : `${total.toLocaleString('pt-BR')} acessos`}
          </span>
        </div>

        <div className="hidden overflow-x-auto md:block">
          <table className="w-full border-separate border-spacing-0 text-[13.5px]">
            <thead>
              <tr className="text-left text-[11.5px] font-semibold uppercase tracking-wider text-muted">
                {['Pessoa', 'Organização', 'Papéis', 'Segurança', 'Último acesso', 'Status'].map((h) => (
                  <th key={h} className="h-10 border-b border-border bg-surface-2/95 px-4">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {list.isLoading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: 6 }).map((__, j) => (
                      <td key={j} className="h-14 border-b border-border/60 px-4">
                        <Skeleton className="h-4 w-full max-w-40" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : !items.length ? (
                <tr>
                  <td colSpan={6}>
                    <EmptyState icon={<Users />} title={q || status || organizationId ? 'Nenhum usuário encontrado' : 'Nenhum usuário ainda'} description={q || status || organizationId ? 'Ajuste a busca ou os filtros.' : undefined} />
                  </td>
                </tr>
              ) : (
                items.map((u) => (
                  <tr
                    key={u.id}
                    tabIndex={0}
                    onClick={() => setOpenId(u.id)}
                    onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), setOpenId(u.id))}
                    className={cn('cursor-pointer outline-none transition-colors hover:bg-primary-soft/35 focus-visible:bg-primary-soft/50', list.isPlaceholderData && 'opacity-60', u.status !== 'ACTIVE' && 'text-muted')}
                  >
                    <td className="h-16 border-b border-border/60 px-4 align-middle">
                      <PersonCell u={u} self={u.userId === me?.user.id} />
                    </td>
                    <td className="border-b border-border/60 px-4">
                      <div className="truncate">{u.organization.name}</div>
                      <div className="text-xs text-subtle">{ORG_KIND_LABELS[u.organization.kind] ?? u.organization.kind}</div>
                    </td>
                    <td className="border-b border-border/60 px-4">
                      <div className="flex flex-wrap gap-1">
                        {u.roles.map((r) => (
                          <Badge key={r} size="sm" tone="neutral">
                            {roleName(r)}
                          </Badge>
                        ))}
                      </div>
                    </td>
                    <td className="border-b border-border/60 px-4">
                      {u.twoFactorEnabled ? (
                        <span className="inline-flex items-center gap-1 text-xs text-success">
                          <ShieldCheck className="size-3.5" /> 2FA
                        </span>
                      ) : (
                        <span className="text-xs text-subtle">Sem 2FA</span>
                      )}
                    </td>
                    <td className="border-b border-border/60 px-4 text-xs text-muted">{u.lastLoginAt ? formatRelative(u.lastLoginAt) : 'Nunca'}</td>
                    <td className="border-b border-border/60 px-4">
                      <StatusPill status={u.status} />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <ul className="divide-y divide-border/70 md:hidden">
          {list.isLoading
            ? Array.from({ length: 5 }).map((_, i) => (
                <li key={i} className="p-4">
                  <Skeleton className="h-16" />
                </li>
              ))
            : items.map((u) => (
                <li key={u.id}>
                  <button onClick={() => setOpenId(u.id)} className="flex w-full items-start justify-between gap-3 p-4 text-left active:bg-surface-2">
                    <div className="min-w-0 space-y-1">
                      <PersonCell u={u} self={u.userId === me?.user.id} />
                      <div className="text-xs text-muted">
                        {u.organization.name} · {u.roles.map(roleName).join(', ')}
                      </div>
                    </div>
                    <StatusPill status={u.status} />
                  </button>
                </li>
              ))}
        </ul>

        <div className="flex items-center justify-between gap-3 border-t border-border/70 px-4 py-2.5 text-[13px] text-muted">
          <span className="tabular">{total ? `${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, total)} de ${total.toLocaleString('pt-BR')}` : '0 resultados'}</span>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon-sm" aria-label="Página anterior" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              <ChevronLeft />
            </Button>
            <span className="tabular">
              {page} / {pages}
            </span>
            <Button variant="ghost" size="icon-sm" aria-label="Próxima página" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
              <ChevronRight />
            </Button>
          </div>
        </div>
      </Card>

      <UserDrawer user={open} onClose={() => setOpenId(null)} />
      <InviteDrawer open={inviting} onClose={() => setInviting(false)} />
    </div>
  );
}
