'use client';

import { OCCURRENCE_SEVERITY_LABELS, OCCURRENCE_TYPE_LABELS, type OccurrenceDto, type OccurrenceSeverity } from '@ordens/contracts';
import { Button, Card, cn, EmptyState, Input, Skeleton } from '@ordens/ui';
import { AlarmClock, AlertTriangle, Bot, Plus, Search } from 'lucide-react';
import { motion } from 'motion/react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { formatDate, formatRelative } from '@/lib/format';
import { useCan, useMe } from '@/lib/session';
import { OccurrenceStatusBadge, SeverityBadge, VisibilityBadge } from './badges';
import { OccurrenceDrawer, type OccurrenceDefaults } from './occurrence-drawer';
import { useOccurrences } from './fiscal-api';

const TABS = [
  { key: 'active', label: 'Em aberto', status: ['OPEN', 'IN_PROGRESS'] },
  { key: 'OPEN', label: 'Abertas', status: ['OPEN'] },
  { key: 'IN_PROGRESS', label: 'Em tratamento', status: ['IN_PROGRESS'] },
  { key: 'RESOLVED', label: 'Resolvidas', status: ['RESOLVED'] },
  { key: 'all', label: 'Todas', status: undefined },
] as const;

export function OccurrencesPage({
  orderId,
  loadId,
  embedded,
  defaults,
}: {
  orderId?: string;
  loadId?: string;
  embedded?: boolean;
  defaults?: OccurrenceDefaults;
}) {
  const can = useCan();
  const { data: me } = useMe();
  const isMatriz = me?.activeMembership?.scope === 'MATRIZ';
  const [tab, setTab] = useState<(typeof TABS)[number]['key']>('active');
  const [severity, setSeverity] = useState<OccurrenceSeverity | 'all'>('all');
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<OccurrenceDto | 'new' | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const current = TABS.find((t) => t.key === tab)!;
  const list = useOccurrences({ q: q || undefined, orderId, loadId, status: current.status ? [...current.status] : undefined, severity: severity === 'all' ? undefined : [severity], pageSize: 200 });
  const all = useOccurrences({ orderId, loadId, pageSize: 200 });
  const allItems = all.data?.items ?? [];
  const count = (status?: readonly string[]) => (status ? allItems.filter((o) => status.includes(o.status)).length : allItems.length);
  const overdue = allItems.filter((o) => o.overdue).length;
  const items = list.data?.items ?? [];
  const selected = open && open !== 'new' ? (items.find((o) => o.id === open.id) ?? open) : null;

  const newButton = can('occurrence.manage') ? (
    <Button size={embedded ? 'sm' : undefined} variant={embedded ? 'soft' : undefined} onClick={() => setOpen('new')}>
      <Plus /> Abrir ocorrência
    </Button>
  ) : null;

  const body = (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-border/70 p-3">
        <div className="-mx-1 flex min-w-0 flex-1 items-center gap-1 overflow-x-auto px-1">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={cn('relative flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium', tab === t.key ? 'text-primary' : 'text-muted hover:bg-surface-2 hover:text-text')}
            >
              {tab === t.key ? <motion.span layoutId={`occ-tab-${orderId ?? loadId ?? 'all'}`} className="absolute inset-0 rounded-full bg-primary-soft ring-1 ring-primary/20" /> : null}
              <span className="relative">{t.label}</span>
              <span className="relative rounded-full bg-surface-3 px-1.5 text-[11px] tabular">{count(t.status)}</span>
            </button>
          ))}
        </div>
        {!embedded ? (
          <>
            <select
              aria-label="Gravidade"
              value={severity}
              onChange={(e) => setSeverity(e.target.value as OccurrenceSeverity | 'all')}
              className="h-9 w-full rounded-md bg-surface px-2.5 text-sm ring-1 ring-border sm:w-auto"
            >
              <option value="all">Todas as gravidades</option>
              {(Object.keys(OCCURRENCE_SEVERITY_LABELS) as OccurrenceSeverity[]).map((s) => (
                <option key={s} value={s}>
                  {OCCURRENCE_SEVERITY_LABELS[s]}
                </option>
              ))}
            </select>
            <div className="relative w-full sm:w-64">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Número ou título…" className="pl-9" aria-label="Buscar ocorrências" />
            </div>
          </>
        ) : (
          newButton
        )}
      </div>

      {list.isLoading ? (
        <div className="space-y-2 p-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-12" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState icon={<AlertTriangle />} title="Nenhuma ocorrência" description={tab === 'active' ? 'Nada pendente de tratamento.' : 'Ajuste os filtros.'} />
      ) : (
        <ul className="divide-y divide-border/70">
          {items.map((o) => (
            <li key={o.id}>
              <button onClick={() => setOpen(o)} className="flex w-full flex-col gap-2 px-4 py-3 text-left transition hover:bg-primary-soft/30 sm:flex-row sm:items-center sm:gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs text-muted">{o.number}</span>
                    {o.source === 'SYSTEM' ? (
                      <span className="inline-flex items-center gap-1 text-[11px] text-info">
                        <Bot className="size-3.5" /> automática
                      </span>
                    ) : null}
                    <span className="text-[11px] text-subtle">{OCCURRENCE_TYPE_LABELS[o.type]}</span>
                  </div>
                  <div className="truncate text-sm font-medium">{o.title}</div>
                  {!embedded ? (
                    <div className="truncate text-xs text-muted">
                      OC{' '}
                      <Link href={`/ordens/${o.order.id}`} onClick={(e) => e.stopPropagation()} className="font-mono text-primary hover:underline">
                        {o.order.number}
                      </Link>
                      {o.load ? <span className="font-mono"> · {o.load.number}</span> : null}
                    </div>
                  ) : o.load && !loadId ? (
                    <div className="font-mono text-xs text-muted">{o.load.number}</div>
                  ) : null}
                </div>
                <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                  <SeverityBadge severity={o.severity} />
                  <OccurrenceStatusBadge status={o.status} />
                  {isMatriz && !embedded ? <VisibilityBadge visibility={o.visibility} /> : null}
                </div>
                <div className="w-40 shrink-0 text-xs text-muted sm:text-right">
                  <div className="truncate">{o.responsible?.name ?? 'Sem responsável'}</div>
                  {o.dueOn ? (
                    <div className={cn('inline-flex items-center gap-1', o.overdue && 'font-medium text-danger')}>
                      {o.overdue ? <AlarmClock className="size-3.5" /> : null}
                      prazo {formatDate(o.dueOn)}
                    </div>
                  ) : (
                    <div>{formatRelative(o.createdAt)}</div>
                  )}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );

  return (
    <>
      {embedded ? (
        body
      ) : (
        <div className="mx-auto flex max-w-[1800px] flex-col gap-5 px-4 py-6 sm:px-6 lg:px-8">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="flex items-center gap-3.5">
              <span className="grid size-11 place-items-center rounded-xl bg-primary-soft text-primary">
                <AlertTriangle className="size-5" />
              </span>
              <div>
                <h1 className="text-2xl font-semibold tracking-tight">Ocorrências</h1>
                <p className="text-sm text-muted">Problemas de qualidade, atrasos, documentos e divergências de peso, com responsável e prazo.</p>
              </div>
            </div>
            {newButton}
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {[
              { label: 'Abertas', value: count(['OPEN']), tone: 'text-warning', onClick: () => setTab('OPEN') },
              { label: 'Em tratamento', value: count(['IN_PROGRESS']), tone: 'text-info', onClick: () => setTab('IN_PROGRESS') },
              { label: 'Prazo vencido', value: overdue, tone: overdue ? 'text-danger' : '', onClick: () => setTab('active') },
              { label: 'Resolvidas', value: count(['RESOLVED']), tone: 'text-success', onClick: () => setTab('RESOLVED') },
            ].map((k) => (
              <button key={k.label} onClick={k.onClick} className="rounded-lg bg-surface p-3 text-left shadow-sm ring-1 ring-border/60 transition hover:-translate-y-px hover:shadow-md">
                <div className="text-xs font-medium text-muted">{k.label}</div>
                <div className={cn('mt-1 text-2xl font-semibold tabular', k.tone)}>{k.value}</div>
              </button>
            ))}
          </div>
          {body}
        </div>
      )}
      <OccurrenceDrawer occurrence={selected} open={open !== null} onClose={() => setOpen(null)} defaults={defaults} />
    </>
  );
}
