'use client';

import type { ManagementCycleDto } from '@ordens/contracts';
import { AsyncCombobox, Card, cn, Skeleton, type ComboOption } from '@ordens/ui';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { CheckCircle2, Clock, Hourglass, Timer, TrendingDown } from 'lucide-react';
import { motion } from 'motion/react';
import Link from 'next/link';
import { useState } from 'react';
import { KpiCard } from '@/features/orders/kpi';
import { lookups } from '@/features/orders/orders-api';
import { get } from '@/lib/api';
import { formatDateTime, formatRelative } from '@/lib/format';

const PERIODS = [
  { key: '30', label: '30 dias' },
  { key: '90', label: '90 dias' },
  { key: '180', label: '180 dias' },
  { key: '365', label: '12 meses' },
] as const;

/** Horas viram a unidade mais legível (h ou dias). */
export function formatHours(h: number | null) {
  if (h === null) return '—';
  if (h < 1) return 'menos de 1 h';
  if (h < 48) return `${h.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} h`;
  return `${(h / 24).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} dias`;
}

function Panel({ title, action, children, className }: { title: string; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
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

function Bars({ rows, empty }: { rows: { key: string; label: string; count: number }[]; empty: string }) {
  const total = rows.reduce((a, r) => a + r.count, 0);
  if (!total) return <p className="py-6 text-center text-sm text-subtle">{empty}</p>;
  return (
    <ul className="space-y-2.5">
      {rows.map((r) => (
        <li key={r.key} className="flex items-center gap-3 text-sm">
          <span className="w-32 shrink-0 text-muted">{r.label}</span>
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-3">
            <motion.div className="h-full rounded-full bg-primary" initial={{ width: 0 }} animate={{ width: `${(r.count / total) * 100}%` }} />
          </div>
          <span className="w-10 text-right font-semibold tabular">{r.count}</span>
        </li>
      ))}
    </ul>
  );
}

/** Painel de Gestão (Q46): quanto tempo a ordem leva do início até a conclusão. */
export function ManagementCyclePage() {
  const [days, setDays] = useState<(typeof PERIODS)[number]['key']>('90');
  const [commodity, setCommodity] = useState<ComboOption | null>(null);
  const query = useQuery({
    queryKey: ['management', 'cycle', days, commodity?.id ?? null],
    queryFn: ({ signal }) => {
      const to = new Date();
      const from = new Date(to.getTime() - (Number(days) - 1) * 86_400_000);
      return get<ManagementCycleDto>('/management/cycle', { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10), commodityId: commodity?.id }, signal);
    },
    placeholderData: keepPreviousData,
  });
  const d = query.data;

  return (
    <div className="mx-auto max-w-[1500px] space-y-5 px-4 py-6 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Gestão do ciclo</h1>
          <p className="mt-1 text-sm text-muted">Tempo entre a publicação da ordem e a conclusão, com as etapas do caminho.</p>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <div className="flex items-center rounded-lg bg-surface p-1 ring-1 ring-border" role="radiogroup" aria-label="Período">
            {PERIODS.map((p) => (
              <button
                key={p.key}
                role="radio"
                aria-checked={days === p.key}
                onClick={() => setDays(p.key)}
                className={cn('relative h-8 rounded-md px-3 text-[13px] font-medium', days === p.key ? 'text-primary' : 'text-muted hover:text-text')}
              >
                {days === p.key ? <motion.span layoutId="cycle-period" className="absolute inset-0 rounded-md bg-primary-soft" /> : null}
                <span className="relative">{p.label}</span>
              </button>
            ))}
          </div>
          <div className="w-full sm:w-60">
            <AsyncCombobox value={commodity} onChange={setCommodity} queryKey={['lookup', 'commodities']} fetchPage={lookups.commodities()} placeholder="Todas as commodities" aria-label="Commodity" />
          </div>
        </div>
      </div>

      {!d ? (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-[112px] rounded-lg" />
            ))}
          </div>
          <Skeleton className="h-72 rounded-lg" />
        </div>
      ) : (
        <div className={cn('space-y-5 transition-opacity', query.isFetching && query.isPlaceholderData && 'opacity-60')}>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard label="Ordens concluídas" value={d.completed} hint={`${d.autoCompleted} automáticas · ${d.completedWithBalance} com saldo`} icon={<CheckCircle2 />} />
            <KpiCard label="Ciclo médio" value={formatHours(d.averagesHours.publishToComplete)} hint="Publicação → conclusão" icon={<Timer />} tone="success" />
            <KpiCard label="Ciclo no pior caso" value={formatHours(d.p90PublishToComplete)} hint="90% concluem em até" icon={<TrendingDown />} tone="warning" />
            <KpiCard label="Até a primeira carga" value={formatHours(d.averagesHours.publishToFirstLoad)} hint="Publicação → primeira carga" icon={<Hourglass />} />
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <Panel title="Etapas do ciclo" className="lg:col-span-1" action={<span className="text-xs text-subtle">média</span>}>
              <dl className="space-y-3 text-sm">
                {[
                  ['Solicitação → publicação', d.averagesHours.submitToPublish, 'Somente solicitações do Comprador'],
                  ['Publicação → primeira carga', d.averagesHours.publishToFirstLoad, null],
                  ['Primeira carga → conclusão', d.averagesHours.firstLoadToComplete, null],
                  ['Publicação → conclusão', d.averagesHours.publishToComplete, null],
                ].map(([label, value, hint]) => (
                  <div key={label as string} className="flex items-start justify-between gap-3 border-b border-border/50 pb-2.5 last:border-0">
                    <dt className="min-w-0">
                      <span className="block text-muted">{label as string}</span>
                      {hint ? <span className="block text-xs text-subtle">{hint as string}</span> : null}
                    </dt>
                    <dd className="shrink-0 font-semibold tabular">{formatHours(value as number | null)}</dd>
                  </div>
                ))}
              </dl>
            </Panel>

            <Panel title="Distribuição do ciclo" action={<span className="text-xs text-subtle">ordens concluídas</span>}>
              <Bars rows={d.histogram} empty="Nenhuma ordem concluída no período." />
            </Panel>

            <Panel title="Ordens abertas por idade" action={<span className="text-xs text-subtle">desde a publicação</span>}>
              <Bars rows={d.openAging} empty="Nenhuma ordem aberta." />
            </Panel>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="Ciclo por commodity" action={<span className="text-xs text-subtle">média · ordens</span>}>
              {d.byCommodity.length === 0 ? (
                <p className="py-6 text-center text-sm text-subtle">Sem conclusões no período.</p>
              ) : (
                <ul className="divide-y divide-border/60 text-sm">
                  {d.byCommodity.map((c) => (
                    <li key={c.id} className="flex items-center justify-between gap-3 py-2.5">
                      <span className="min-w-0 truncate">{c.name}</span>
                      <span className="shrink-0 text-right">
                        <span className="font-semibold tabular">{formatHours(c.avgHours)}</span>
                        <span className="ml-2 text-xs text-subtle">{c.orders} ordem(ns)</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            <Panel title="Ordens mais demoradas" action={<span className="text-xs text-subtle">atualizado {formatRelative(d.generatedAt)}</span>}>
              {d.slowest.length === 0 ? (
                <p className="py-6 text-center text-sm text-subtle">Sem conclusões no período.</p>
              ) : (
                <ul className="divide-y divide-border/60 text-sm">
                  {d.slowest.map((o) => (
                    <li key={o.id}>
                      <Link href={`/ordens/${o.id}`} className="flex items-center justify-between gap-3 py-2.5 transition hover:bg-surface-2/60">
                        <span className="min-w-0">
                          <span className="block truncate font-mono">{o.number}</span>
                          <span className="block truncate text-xs text-subtle">
                            {[o.commodity, o.counterpart].filter(Boolean).join(' · ')} · concluída em {formatDateTime(o.completedAt)}
                          </span>
                        </span>
                        <span className="shrink-0 text-right">
                          <span className="block font-semibold tabular">{formatHours(o.hours)}</span>
                          <span className="flex items-center gap-1 text-xs text-subtle">
                            <Clock className="size-3" /> {o.via === 'auto' ? 'automática' : 'informada'}
                          </span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>
        </div>
      )}
    </div>
  );
}
