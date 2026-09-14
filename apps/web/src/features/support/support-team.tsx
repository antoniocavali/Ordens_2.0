'use client';

import { SUPPORT_FIRST_RESPONSE_SLA_MINUTES, SUPPORT_QUEUE_LABELS, SUPPORT_QUEUES, type SupportQueue, type SupportTeamMember } from '@ordens/contracts';
import { Card, cn, EmptyState, Input, Skeleton } from '@ordens/ui';
import { AlarmClock, Search, ShieldCheck, ShieldOff, UsersRound } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { ApiRequestError } from '@/lib/api';
import { useSupportAccess, useSupportTeam, useUpdateTeamMember } from './support-api';

function QueueSwitch({ label, checked, disabled, onChange }: { label: string; checked: boolean; disabled?: boolean; onChange: (next: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 disabled:cursor-not-allowed disabled:opacity-50',
        checked ? 'bg-primary' : 'bg-surface-3 ring-1 ring-border',
      )}
    >
      <span className={cn('inline-block size-4 rounded-full bg-white shadow transition-transform', checked ? 'translate-x-6' : 'translate-x-1')} />
    </button>
  );
}

function Situation({ m }: { m: SupportTeamMember }) {
  if (m.supervisor) {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-primary">
        <ShieldCheck className="size-3.5" /> Supervisão · todas as filas
      </span>
    );
  }
  if (!m.canAttend) return <span className="text-xs text-subtle">Sem permissão de atendente</span>;
  if (!m.queues.length) return <span className="text-xs font-medium text-warning">Não atende nenhuma fila</span>;
  return <span className="text-xs text-muted">Atende {m.queues.map((q) => SUPPORT_QUEUE_LABELS[q]).join(' e ')}</span>;
}

/** Equipe do atendimento (Q31): a supervisão define em quais filas cada atendente atua. */
export function SupportTeamPage() {
  const access = useSupportAccess();
  const team = useSupportTeam(access.supervisor);
  const update = useUpdateTeamMember();
  const [search, setSearch] = useState('');

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (team.data ?? []).filter((m) => !q || m.name.toLowerCase().includes(q) || m.email.toLowerCase().includes(q));
  }, [team.data, search]);

  if (access.ready && !access.supervisor) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16">
        <EmptyState icon={<ShieldOff />} title="Sem acesso à equipe" description="Somente gestores e administradores definem as filas de cada atendente." />
      </div>
    );
  }

  const toggle = (m: SupportTeamMember, queue: SupportQueue, on: boolean) => {
    const queues = on ? [...m.queues, queue] : m.queues.filter((q) => q !== queue);
    update.mutate(
      { membershipId: m.membershipId, queues },
      {
        onSuccess: (r) =>
          toast.success(
            r.releasedConversations
              ? `${m.name}: filas atualizadas. ${r.releasedConversations} conversa(s) voltaram para a fila sem responsável.`
              : `${m.name}: filas atualizadas`,
          ),
        onError: (err) => toast.error(err instanceof ApiRequestError ? err.message : 'Não foi possível atualizar as filas.'),
      },
    );
  };

  const attending = (queue: SupportQueue) => (team.data ?? []).filter((m) => !m.supervisor && m.queues.includes(queue)).length;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5 px-4 py-6 sm:px-6 lg:px-8">
      <div className="flex items-center gap-3.5">
        <span className="grid size-11 place-items-center rounded-xl bg-primary-soft text-primary">
          <UsersRound className="size-5" />
        </span>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Equipe do atendimento</h1>
          <p className="text-sm text-muted">Defina em quais filas cada atendente trabalha. As mudanças valem na hora.</p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {SUPPORT_QUEUES.map((q) => (
          <Card key={q} className="p-4">
            <div className="text-xs text-muted">Fila de {SUPPORT_QUEUE_LABELS[q]}</div>
            <div className="mt-1 text-2xl font-semibold tabular">{team.data ? attending(q) : '—'}</div>
            <div className="text-xs text-subtle">atendentes, além da supervisão</div>
          </Card>
        ))}
        <Card className="p-4">
          <div className="flex items-center gap-1.5 text-xs text-muted">
            <AlarmClock className="size-3.5" /> Prazo de 1ª resposta
          </div>
          <div className="mt-1 text-2xl font-semibold tabular">{SUPPORT_FIRST_RESPONSE_SLA_MINUTES / 60} h</div>
          <div className="text-xs text-subtle">atendentes da fila e supervisão são avisados ao estourar</div>
        </Card>
      </div>

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 p-3">
          <p className="px-1 text-xs text-muted">
            Podem entrar em filas os usuários com papel <strong>Operador</strong> ou <strong>Atendente</strong>. Gestores e administradores supervisionam todas.
          </p>
          <div className="relative w-full sm:w-72">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Nome ou e-mail…" className="pl-9" aria-label="Buscar na equipe" />
          </div>
        </div>
        {team.isLoading || !access.ready ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-12" />
            ))}
          </div>
        ) : team.isError ? (
          <p className="p-6 text-sm text-danger">Não foi possível carregar a equipe.</p>
        ) : !rows.length ? (
          <EmptyState icon={<UsersRound />} title="Ninguém encontrado" description="Ajuste a busca." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-170 text-sm">
              <thead>
                <tr className="border-b border-border/60 text-left text-xs uppercase tracking-wider text-muted">
                  <th className="px-4 py-2.5">Pessoa</th>
                  <th className="px-4 py-2.5">Papel</th>
                  {SUPPORT_QUEUES.map((q) => (
                    <th key={q} className="px-4 py-2.5 text-center">
                      {SUPPORT_QUEUE_LABELS[q]}
                    </th>
                  ))}
                  <th className="px-4 py-2.5">Situação</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((m) => {
                  const saving = update.isPending && update.variables?.membershipId === m.membershipId;
                  return (
                    <tr key={m.membershipId} className={cn('border-t border-border/60', !m.canAttend && 'text-muted')}>
                      <td className="px-4 py-3">
                        <div className="font-medium text-text">{m.name}</div>
                        <div className="text-xs text-subtle">{m.email}</div>
                      </td>
                      <td className="px-4 py-3 text-xs">{m.roles.join(', ')}</td>
                      {SUPPORT_QUEUES.map((q) => (
                        <td key={q} className="px-4 py-3 text-center">
                          <QueueSwitch
                            label={SUPPORT_QUEUE_LABELS[q]}
                            checked={m.queues.includes(q)}
                            disabled={m.supervisor || !m.canAttend || saving}
                            onChange={(on) => toggle(m, q, on)}
                          />
                        </td>
                      ))}
                      <td className="px-4 py-3">
                        <Situation m={m} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
