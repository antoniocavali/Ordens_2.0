'use client';

import {
  SUPPORT_ANALYTICS_PERIODS,
  SUPPORT_PRIORITY_LABELS,
  SUPPORT_QUEUE_LABELS,
  SUPPORT_QUEUE_SLUGS,
  SUPPORT_STATUS_LABELS,
  type SupportAnalyticsPeriod,
  type SupportQueue,
} from '@ordens/contracts';
import { Button, Card, cn, EmptyState, Skeleton } from '@ordens/ui';
import { ArrowRight, CheckCircle2, Clock, Inbox, LineChart, MessageSquare, Timer, UserX, type LucideIcon } from 'lucide-react';
import { motion } from 'motion/react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { ReactNode } from 'react';
import { KpiCard } from '@/features/orders/kpi';
import { formatRelative } from '@/lib/format';
import { BarList, DailyVolumeChart, Delta, formatDuration, HourStrip } from './support-charts';
import { useSupportAccess, useSupportAnalytics } from './support-api';

const STATUS_BAR: Record<string, string> = { WAITING: 'bg-warning', OPEN: 'bg-info', PENDING_CUSTOMER: 'bg-primary', BOT: 'bg-subtle' };
const PRIORITY_BAR: Record<string, string> = { URGENT: 'bg-danger', HIGH: 'bg-warning', NORMAL: 'bg-primary', LOW: 'bg-subtle' };
const BUCKET_BAR: Record<string, string> = { lt15: 'bg-success', lt60: 'bg-success/70', lt240: 'bg-warning/80', lt1440: 'bg-warning', gte1440: 'bg-danger' };

function Panel({ title, action, children, className }: { title: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <Card className={cn('flex flex-col overflow-hidden', className)}>
      <div className="flex items-center justify-between gap-3 border-b border-border/70 px-5 py-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        {action}
      </div>
      <div className="flex-1 p-5">{children}</div>
    </Card>
  );
}

function Segmented<T extends string | number>({ label, value, options, onChange, layoutId }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; layoutId: string }) {
  return (
    <div className="flex items-center rounded-lg bg-surface p-1 ring-1 ring-border" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn('relative h-8 rounded-md px-3 text-[13px] font-medium', value === o.value ? 'text-primary' : 'text-muted hover:text-text')}
        >
          {value === o.value ? <motion.span layoutId={layoutId} className="absolute inset-0 rounded-md bg-primary-soft" /> : null}
          <span className="relative">{o.label}</span>
        </button>
      ))}
    </div>
  );
}

const ICONS = { opened: MessageSquare, resolved: CheckCircle2, frt: Timer, rt: Clock, backlog: Inbox, abandoned: UserX } satisfies Record<string, LucideIcon>;

/** Indicadores de atendimento: volume, tempos, backlog, filas e desempenho do time. Recorte pelas filas do usuário. */
export function SupportDashboard() {
  const access = useSupportAccess();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const requestedQueue = params.get('fila') as SupportQueue | null;
  const requestedDays = Number(params.get('periodo')) as SupportAnalyticsPeriod;
  const days: SupportAnalyticsPeriod = (SUPPORT_ANALYTICS_PERIODS as readonly number[]).includes(requestedDays) ? requestedDays : 30;
  // Time de uma fila só enxerga a própria; "Todas" só para quem atende mais de uma.
  const queue: SupportQueue | undefined =
    access.queues.length === 1 ? access.queues[0] : requestedQueue && access.queues.includes(requestedQueue) ? requestedQueue : undefined;

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    router.replace(next.size ? `${pathname}?${next}` : pathname, { scroll: false });
  };

  const analytics = useSupportAnalytics({ days, queue }, access.ready && access.queues.length > 0);
  const a = analytics.data;

  if (access.ready && !access.queues.length) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16">
        <EmptyState icon={<LineChart />} title="Sem acesso aos indicadores" description="Os indicadores ficam disponíveis para os times de Faturamento, Suporte e a supervisão do atendimento." />
      </div>
    );
  }

  const title = queue && access.queues.length === 1 ? `Indicadores · ${SUPPORT_QUEUE_LABELS[queue]}` : 'Indicadores de atendimento';
  const panelHref = queue ? `/atendimento/${SUPPORT_QUEUE_SLUGS[queue]}` : '/atendimento';

  return (
    <div className="mx-auto max-w-[1600px] space-y-5 px-4 py-6 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <span className="grid size-11 place-items-center rounded-xl bg-primary-soft text-primary">
            <LineChart className="size-5" />
          </span>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
            <p className="text-sm text-muted">Volume, tempos de resposta e backlog das conversas abertas pelo chat.</p>
          </div>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <Segmented
            label="Período"
            layoutId="support-period"
            value={days}
            onChange={(v) => setParam('periodo', String(v))}
            options={SUPPORT_ANALYTICS_PERIODS.map((d) => ({ value: d, label: `${d} dias` }))}
          />
          {access.queues.length > 1 ? (
            <Segmented
              label="Fila"
              layoutId="support-queue"
              value={queue ?? 'all'}
              onChange={(v) => setParam('fila', v === 'all' ? null : v)}
              options={[{ value: 'all', label: 'Todas' }, ...access.queues.map((q) => ({ value: q, label: SUPPORT_QUEUE_LABELS[q] }))]}
            />
          ) : null}
          <Button asChild variant="outline">
            <Link href={panelHref}>
              Abrir painel <ArrowRight />
            </Link>
          </Button>
        </div>
      </div>

      {analytics.isError ? (
        <Card className="p-6 text-sm text-danger">Não foi possível carregar os indicadores. Tente novamente em instantes.</Card>
      ) : !a ? (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-28 rounded-lg" />
            ))}
          </div>
          <Skeleton className="h-72 rounded-lg" />
        </div>
      ) : (
        <div className={cn('space-y-5 transition-opacity', analytics.isFetching && analytics.isPlaceholderData && 'opacity-60')}>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
            <KpiCard label="Conversas abertas" value={a.totals.opened} hint={<Delta current={a.totals.opened} previous={a.previous.opened} />} icon={<ICONS.opened />} />
            <KpiCard
              label="Resolvidas"
              value={a.totals.resolved}
              tone="success"
              hint={a.totals.resolutionRate !== null ? `${a.totals.resolutionRate}% das encaminhadas` : <Delta current={a.totals.resolved} previous={a.previous.resolved} />}
              icon={<ICONS.resolved />}
            />
            <KpiCard
              label="1ª resposta média"
              value={formatDuration(a.totals.avgFirstResponseMinutes)}
              hint={
                a.totals.firstResponseWithinSlaRate !== null ? (
                  `${a.totals.firstResponseWithinSlaRate}% dentro do SLA de 1 h`
                ) : (
                  <Delta current={a.totals.avgFirstResponseMinutes} previous={a.previous.avgFirstResponseMinutes} lowerIsBetter />
                )
              }
              icon={<ICONS.frt />}
            />
            <KpiCard label="90% respondidas em até" value={formatDuration(a.totals.p90FirstResponseMinutes)} hint={`resolução média: ${formatDuration(a.totals.avgResolutionMinutes)}`} icon={<ICONS.rt />} />
            <KpiCard
              label="Backlog agora"
              value={a.totals.backlog}
              tone={a.totals.slaBreachedNow ? 'danger' : a.totals.unassigned ? 'warning' : 'primary'}
              hint={`${a.totals.slaBreachedNow} fora do SLA · ${a.totals.unassigned} sem responsável`}
              icon={<ICONS.backlog />}
            />
            {!queue && a.queues.length > 1 ? (
              <KpiCard label="Desistências no assistente" value={a.totals.abandonedInBot} hint="encerradas antes da fila" tone={a.totals.abandonedInBot ? 'danger' : 'primary'} icon={<ICONS.abandoned />} />
            ) : (
              <KpiCard label="Encaminhadas à fila" value={a.totals.queued} hint={`nos últimos ${a.days} dias`} icon={<ICONS.opened />} />
            )}
          </div>

          <div className="grid gap-4 lg:grid-cols-5">
            <Panel title={`Volume diário · ${a.days} dias`} className="lg:col-span-3" action={<span className="text-xs text-subtle">atualizado {formatRelative(a.generatedAt)}</span>}>
              <DailyVolumeChart points={a.daily} />
            </Panel>
            <Panel title="Backlog por status" className="lg:col-span-2" action={<span className="text-xs tabular text-subtle">{a.backlogByStatus.reduce((n, s) => n + s.count, 0)} conversas</span>}>
              <BarList
                ariaLabel="Backlog por status"
                empty="Nenhuma conversa em andamento."
                rows={a.backlogByStatus.map((s) => ({ key: s.status, label: SUPPORT_STATUS_LABELS[s.status], count: s.count, className: STATUS_BAR[s.status] }))}
              />
              <div className="mt-6 border-t border-border/60 pt-4">
                <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted">Por prioridade</h3>
                <BarList
                  ariaLabel="Backlog por prioridade"
                  empty="Sem backlog."
                  rows={a.backlogByPriority.map((p) => ({ key: p.priority, label: SUPPORT_PRIORITY_LABELS[p.priority], count: p.count, className: PRIORITY_BAR[p.priority] }))}
                />
              </div>
            </Panel>
          </div>

          <div className="grid gap-4 lg:grid-cols-5">
            <Panel title="Tempo até a 1ª resposta" className="lg:col-span-2" action={<span className="text-xs text-subtle">desde a abertura</span>}>
              <BarList
                ariaLabel="Distribuição do tempo até a primeira resposta"
                empty="Nenhuma conversa respondida no período."
                rows={a.firstResponseBuckets.map((b) => ({ key: b.key, label: b.label, count: b.count, className: BUCKET_BAR[b.key] }))}
              />
            </Panel>
            <Panel title="Horário de abertura" className="lg:col-span-3" action={<span className="text-xs text-subtle">horário de Brasília</span>}>
              <HourStrip hours={a.byHour} />
            </Panel>
          </div>

          <div className="grid gap-4 lg:grid-cols-5">
            <Panel title={a.queues.length > 1 ? 'Comparativo das filas' : 'Quem abre conversas'} className="lg:col-span-3">
              {a.queues.length > 1 ? (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-130 text-sm">
                    <thead>
                      <tr className="text-left text-xs uppercase tracking-wider text-muted">
                        <th className="pb-2">Fila</th>
                        <th className="pb-2 text-right">Abertas</th>
                        <th className="pb-2 text-right">Resolvidas</th>
                        <th className="pb-2 text-right">Backlog</th>
                        <th className="pb-2 text-right">1ª resposta</th>
                        <th className="pb-2 text-right">Resolução</th>
                      </tr>
                    </thead>
                    <tbody>
                      {a.byQueue.map((q) => (
                        <tr key={q.queue} className="border-t border-border/60">
                          <td className="py-2.5 pr-3 font-medium">
                            <Link href={`/atendimento/${SUPPORT_QUEUE_SLUGS[q.queue]}`} className="hover:text-primary hover:underline">
                              {SUPPORT_QUEUE_LABELS[q.queue]}
                            </Link>
                          </td>
                          <td className="py-2.5 text-right tabular">{q.opened}</td>
                          <td className="py-2.5 text-right tabular">{q.resolved}</td>
                          <td className={cn('py-2.5 text-right tabular', q.backlog > 0 && 'font-medium text-warning')}>{q.backlog}</td>
                          <td className="py-2.5 text-right tabular">{formatDuration(q.avgFirstResponseMinutes)}</td>
                          <td className="py-2.5 text-right tabular">{formatDuration(q.avgResolutionMinutes)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <BarList ariaLabel="Conversas por perfil de quem abriu" empty="Nenhuma conversa no período." rows={a.byRequester.map((r) => ({ key: r.kind, label: r.label, count: r.count }))} />
              )}
            </Panel>
            <Panel title={a.queues.length > 1 ? 'Quem abre conversas' : 'Resumo'} className="lg:col-span-2">
              {a.queues.length > 1 ? (
                <BarList ariaLabel="Conversas por perfil de quem abriu" empty="Nenhuma conversa no período." rows={a.byRequester.map((r) => ({ key: r.kind, label: r.label, count: r.count }))} />
              ) : (
                <dl className="grid grid-cols-2 gap-3 text-sm">
                  {[
                    ['Abertas', String(a.totals.opened)],
                    ['Resolvidas', String(a.totals.resolved)],
                    ['Backlog', String(a.totals.backlog)],
                    ['Sem responsável', String(a.totals.unassigned)],
                    ['Resolução média', formatDuration(a.totals.avgResolutionMinutes)],
                    ['Taxa de resolução', a.totals.resolutionRate !== null ? `${a.totals.resolutionRate}%` : '—'],
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-md bg-surface-2 px-3 py-2.5">
                      <dt className="text-xs text-muted">{label}</dt>
                      <dd className="text-lg font-semibold tabular">{value}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </Panel>
          </div>

          <Panel title="Desempenho do time" action={<span className="text-xs text-subtle">responsável atual · {a.days} dias</span>}>
            {!a.agents.length ? (
              <p className="py-6 text-center text-sm text-subtle">Nenhum atendimento com responsável no período.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-140 text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wider text-muted">
                      <th className="pb-2">Atendente</th>
                      <th className="pb-2 text-right">Em andamento</th>
                      <th className="pb-2 text-right">Resolvidas</th>
                      <th className="pb-2 text-right">Respostas</th>
                      <th className="pb-2 text-right">1ª resposta média</th>
                    </tr>
                  </thead>
                  <tbody>
                    {a.agents.map((ag) => {
                      const top = Math.max(...a.agents.map((x) => x.resolved), 1);
                      return (
                        <tr key={ag.id} className="border-t border-border/60">
                          <td className="py-2.5 pr-3">
                            <div className="font-medium">{ag.name}</div>
                            <div className="mt-1 h-1 w-32 overflow-hidden rounded-full bg-surface-3">
                              <motion.div className="h-full rounded-full bg-success" initial={{ width: 0 }} animate={{ width: `${(ag.resolved / top) * 100}%` }} />
                            </div>
                          </td>
                          <td className={cn('py-2.5 text-right tabular', ag.openNow > 0 && 'font-medium')}>{ag.openNow}</td>
                          <td className="py-2.5 text-right tabular">{ag.resolved}</td>
                          <td className="py-2.5 text-right tabular">{ag.replies}</td>
                          <td className="py-2.5 text-right tabular">{formatDuration(ag.avgFirstResponseMinutes)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </div>
      )}
    </div>
  );
}
