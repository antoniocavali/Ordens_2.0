'use client';

import {
  SUPPORT_PRIORITY_LABELS,
  SUPPORT_QUEUE_LABELS,
  SUPPORT_STATUS_LABELS,
  type SupportConversationDto,
  type SupportPriority,
  type SupportQueue,
  type SupportStatus,
} from '@ordens/contracts';
import { AsyncCombobox, Button, Card, cn, EmptyState, Input, Skeleton } from '@ordens/ui';
import { ArrowLeft, Flag, Headphones, Link2, Search, UserCheck } from 'lucide-react';
import { motion } from 'motion/react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { KpiCard } from '@/features/orders/kpi';
import { ApiRequestError } from '@/lib/api';
import { formatRelative } from '@/lib/format';
import { useMe } from '@/lib/session';
import { ConversationThread, SupportStatusBadge } from './conversation-thread';
import { agentLookup, useConversation, useSupportMutations, useSupportQueue, useSupportSummary } from './support-api';

const TABS: { key: string; label: string; status: SupportStatus[] }[] = [
  { key: 'queue', label: 'Na fila', status: ['WAITING'] },
  { key: 'open', label: 'Em atendimento', status: ['OPEN'] },
  { key: 'customer', label: 'Aguardando cliente', status: ['PENDING_CUSTOMER'] },
  { key: 'resolved', label: 'Resolvidas', status: ['RESOLVED'] },
  { key: 'closed', label: 'Encerradas', status: ['CLOSED'] },
  { key: 'bot', label: 'Com o assistente', status: ['BOT'] },
];

const TRANSITION_LABEL: Partial<Record<SupportStatus, string>> = {
  OPEN: 'Em atendimento',
  PENDING_CUSTOMER: 'Aguardar cliente',
  RESOLVED: 'Resolver',
  CLOSED: 'Encerrar',
  WAITING: 'Voltar à fila',
};

const PRIORITY_TONE: Record<SupportPriority, string> = { LOW: 'text-subtle', NORMAL: 'text-muted', HIGH: 'text-warning', URGENT: 'text-danger' };
const errorMessage = (err: unknown) => (err instanceof ApiRequestError ? err.message : 'Não foi possível concluir a ação.');

function QueueItem({ c, active, onOpen }: { c: SupportConversationDto; active: boolean; onOpen: () => void }) {
  return (
    <button
      onClick={onOpen}
      aria-current={active ? 'true' : undefined}
      className={cn('flex w-full flex-col gap-1.5 px-4 py-3 text-left transition hover:bg-primary-soft/30', active && 'bg-primary-soft/50')}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2">
          <span className="font-mono text-xs text-muted">{c.number}</span>
          {c.queue ? <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[11px] font-medium">{SUPPORT_QUEUE_LABELS[c.queue]}</span> : null}
          {c.priority !== 'NORMAL' ? (
            <span className={cn('inline-flex items-center gap-0.5 text-[11px] font-medium', PRIORITY_TONE[c.priority])}>
              <Flag className="size-3" /> {SUPPORT_PRIORITY_LABELS[c.priority]}
            </span>
          ) : null}
        </span>
        <span className="text-[11px] text-subtle">{formatRelative(c.lastMessageAt)}</span>
      </div>
      <span className="truncate text-sm font-medium">{c.subject ?? 'Sem assunto'}</span>
      <span className="truncate text-xs text-muted">
        {c.requester.name}
        {c.requester.organization ? ` · ${c.requester.organization}` : ''}
      </span>
      <span className="flex flex-wrap items-center gap-2">
        <SupportStatusBadge status={c.status} />
        {c.waitingMinutes !== null ? (
          <span className={cn('text-[11px] font-medium', c.waitingMinutes >= 30 ? 'text-danger' : 'text-warning')}>esperando há {c.waitingMinutes} min</span>
        ) : null}
        <span className="text-[11px] text-subtle">{c.assignee ? c.assignee.name : 'Sem responsável'}</span>
      </span>
    </button>
  );
}

export function SupportPanel() {
  const { data: me } = useMe();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [tab, setTab] = useState('queue');
  const [queue, setQueue] = useState<SupportQueue | 'all'>('all');
  const [assignee, setAssignee] = useState<'all' | 'me' | 'none'>('all');
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const selectedId = params.get('conversa');

  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const current = TABS.find((t) => t.key === tab)!;
  const summary = useSupportSummary();
  const list = useSupportQueue({ status: current.status, queue: queue === 'all' ? undefined : queue, assignee: assignee === 'all' ? undefined : assignee, q: q || undefined });
  const detail = useConversation(selectedId);
  const { send, assign, transition, update } = useSupportMutations();
  const s = summary.data;
  const d = detail.data;

  const select = (id: string | null) => {
    const next = new URLSearchParams(params.toString());
    if (id) next.set('conversa', id);
    else next.delete('conversa');
    router.replace(next.size ? `${pathname}?${next}` : pathname, { scroll: false });
  };
  const run = (promise: Promise<unknown>, success?: string) =>
    promise.then(() => success && toast.success(success)).catch((err) => toast.error(errorMessage(err)));

  return (
    <div className="mx-auto flex max-w-[1800px] flex-col gap-5 px-4 py-6 sm:px-6 lg:px-8">
      <div className="flex items-center gap-3.5">
        <span className="grid size-11 place-items-center rounded-xl bg-primary-soft text-primary">
          <Headphones className="size-5" />
        </span>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Atendimento</h1>
          <p className="text-sm text-muted">Demandas de faturamento e suporte abertas pelo chat, com fila, responsável e status.</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {s ? (
          <>
            <KpiCard label="Fila Faturamento" value={s.waiting.BILLING} tone={s.waiting.BILLING ? 'warning' : 'primary'} active={tab === 'queue' && queue === 'BILLING'} onClick={() => { setTab('queue'); setQueue('BILLING'); }} />
            <KpiCard label="Fila Suporte" value={s.waiting.SUPPORT} tone={s.waiting.SUPPORT ? 'warning' : 'primary'} active={tab === 'queue' && queue === 'SUPPORT'} onClick={() => { setTab('queue'); setQueue('SUPPORT'); }} />
            <KpiCard label="Em atendimento" value={s.open} hint={`${s.pendingCustomer} aguardando cliente`} onClick={() => { setTab('open'); setQueue('all'); }} />
            <KpiCard label="Sem responsável" value={s.unassigned} tone={s.unassigned ? 'danger' : 'primary'} active={assignee === 'none'} onClick={() => setAssignee('none')} />
            <KpiCard label="Comigo" value={s.mine} active={assignee === 'me'} onClick={() => setAssignee('me')} />
            <KpiCard
              label="Resolvidas hoje"
              value={s.resolvedToday}
              tone="success"
              hint={s.avgFirstResponseMinutes !== null ? `1ª resposta média: ${s.avgFirstResponseMinutes} min` : s.oldestWaitingMinutes !== null ? `espera mais antiga: ${s.oldestWaitingMinutes} min` : undefined}
            />
          </>
        ) : (
          Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-[92px] rounded-lg" />)
        )}
      </div>

      <div className="grid min-h-[620px] gap-4 lg:grid-cols-[minmax(340px,440px)_1fr]">
        <Card className={cn('flex min-h-0 flex-col overflow-hidden', selectedId && 'hidden lg:flex')}>
          <div className="space-y-2 border-b border-border/70 p-3">
            <div className="-mx-1 flex items-center gap-1 overflow-x-auto px-1">
              {TABS.map((t) => (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  className={cn('relative h-8 shrink-0 rounded-full px-3 text-[13px] font-medium', tab === t.key ? 'text-primary' : 'text-muted hover:bg-surface-2 hover:text-text')}
                >
                  {tab === t.key ? <motion.span layoutId="support-tab" className="absolute inset-0 rounded-full bg-primary-soft ring-1 ring-primary/20" /> : null}
                  <span className="relative">{t.label}</span>
                </button>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              <select aria-label="Fila" value={queue} onChange={(e) => setQueue(e.target.value as SupportQueue | 'all')} className="h-9 rounded-md bg-surface px-2.5 text-sm ring-1 ring-border">
                <option value="all">Todas as filas</option>
                <option value="BILLING">Faturamento</option>
                <option value="SUPPORT">Suporte</option>
              </select>
              <select aria-label="Responsável" value={assignee} onChange={(e) => setAssignee(e.target.value as 'all' | 'me' | 'none')} className="h-9 rounded-md bg-surface px-2.5 text-sm ring-1 ring-border">
                <option value="all">Qualquer responsável</option>
                <option value="me">Comigo</option>
                <option value="none">Sem responsável</option>
              </select>
              <div className="relative min-w-40 flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" />
                <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Número ou assunto…" className="pl-9" aria-label="Buscar atendimentos" />
              </div>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {list.isLoading ? (
              <div className="space-y-2 p-4">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-20" />
                ))}
              </div>
            ) : !list.data?.items.length ? (
              <EmptyState icon={<Headphones />} title="Nada por aqui" description={tab === 'queue' ? 'Nenhuma demanda aguardando atendimento.' : 'Ajuste os filtros.'} />
            ) : (
              <ul className="divide-y divide-border/60">
                {list.data.items.map((c) => (
                  <li key={c.id}>
                    <QueueItem c={c} active={c.id === selectedId} onOpen={() => select(c.id)} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>

        <Card className={cn('flex min-h-[620px] flex-col overflow-hidden', !selectedId && 'hidden lg:flex')}>
          {!selectedId ? (
            <EmptyState className="my-auto" icon={<Headphones />} title="Selecione um atendimento" description="As mensagens, o responsável e as ações aparecem aqui." />
          ) : !d ? (
            <div className="space-y-3 p-5">
              <Skeleton className="h-20" />
              <Skeleton className="h-64" />
            </div>
          ) : (
            <>
              <div className="space-y-3 border-b border-border/70 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-2">
                    <Button variant="ghost" size="icon-sm" className="lg:hidden" aria-label="Voltar para a lista" onClick={() => select(null)}>
                      <ArrowLeft />
                    </Button>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-sm font-semibold">{d.number}</span>
                        <SupportStatusBadge status={d.status} />
                        {d.waitingMinutes !== null ? <span className="text-xs text-warning">esperando há {d.waitingMinutes} min</span> : null}
                      </div>
                      <div className="truncate text-base font-medium">{d.subject ?? 'Sem assunto'}</div>
                      <div className="text-xs text-muted">
                        {d.requester.name}
                        {d.requester.organization ? ` · ${d.requester.organization}` : ''} · aberta {formatRelative(d.createdAt)}
                        {d.order ? (
                          <>
                            {' · '}
                            <Link href={`/ordens/${d.order.id}`} className="inline-flex items-center gap-0.5 text-primary hover:underline">
                              <Link2 className="size-3" /> OC {d.order.number}
                            </Link>
                          </>
                        ) : null}
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {d.allowedTransitions.map((to) => (
                      <Button
                        key={to}
                        size="sm"
                        variant={to === 'RESOLVED' ? 'primary' : to === 'CLOSED' ? 'ghost' : 'outline'}
                        loading={transition.isPending && transition.variables?.to === to}
                        onClick={() => void run(transition.mutateAsync({ id: d.id, to }), `${d.number}: ${SUPPORT_STATUS_LABELS[to]}`)}
                      >
                        {TRANSITION_LABEL[to] ?? SUPPORT_STATUS_LABELS[to]}
                      </Button>
                    ))}
                  </div>
                </div>

                {d.status !== 'CLOSED' ? (
                  <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto_auto]">
                    <div className="flex items-center gap-2">
                      <div className="min-w-0 flex-1">
                        <AsyncCombobox
                          aria-label="Responsável"
                          value={d.assignee ? { id: d.assignee.id, label: d.assignee.name } : null}
                          onChange={(next) => void run(assign.mutateAsync({ id: d.id, assigneeUserId: next?.id ?? null }), next ? `Atribuída a ${next.label}` : 'Responsável removido')}
                          queryKey={['lookup', 'support-agents']}
                          fetchPage={agentLookup}
                          placeholder="Sem responsável"
                        />
                      </div>
                      {me && d.assignee?.id !== me.user.id ? (
                        <Button variant="soft" size="sm" loading={assign.isPending} onClick={() => void run(assign.mutateAsync({ id: d.id, assigneeUserId: me.user.id }), 'Atendimento assumido')}>
                          <UserCheck /> Assumir
                        </Button>
                      ) : null}
                    </div>
                    <select
                      aria-label="Fila"
                      value={d.queue ?? ''}
                      disabled={!d.queue}
                      onChange={(e) => void run(update.mutateAsync({ id: d.id, queue: e.target.value as SupportQueue }), `Transferida para ${SUPPORT_QUEUE_LABELS[e.target.value as SupportQueue]}`)}
                      className="h-9 rounded-md bg-surface px-2.5 text-sm ring-1 ring-border"
                    >
                      {!d.queue ? <option value="">Sem fila</option> : null}
                      <option value="BILLING">Faturamento</option>
                      <option value="SUPPORT">Suporte</option>
                    </select>
                    <select
                      aria-label="Prioridade"
                      value={d.priority}
                      onChange={(e) => void run(update.mutateAsync({ id: d.id, priority: e.target.value as SupportPriority }), 'Prioridade atualizada')}
                      className="h-9 rounded-md bg-surface px-2.5 text-sm ring-1 ring-border"
                    >
                      {(Object.keys(SUPPORT_PRIORITY_LABELS) as SupportPriority[]).map((p) => (
                        <option key={p} value={p}>
                          Prioridade {SUPPORT_PRIORITY_LABELS[p].toLowerCase()}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : null}
              </div>
              <ConversationThread
                conversation={d}
                mode="agent"
                sending={send.isPending}
                onSend={(body, internal) =>
                  send.mutateAsync({ id: d.id, body, internal }).catch((err) => {
                    toast.error(errorMessage(err));
                    throw err;
                  })
                }
              />
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
