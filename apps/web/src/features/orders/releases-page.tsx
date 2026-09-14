'use client';

import { RELEASE_EXPIRING_DAYS, RELEASE_STATUS_LABELS, type ReleaseListItem, type ReleaseStatus } from '@ordens/contracts';
import { Badge, Button, Card, cn, EmptyState, Input, Skeleton } from '@ordens/ui';
import { AlarmClock, ChevronLeft, ChevronRight, PackageCheck, PackageX, Search } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { formatDate, formatDateTime, formatQty } from '@/lib/format';
import { CancelReleaseDialog, type CancelReleaseTarget } from './cancel-release-dialog';
import { useReleases, useReleasesSummary, type ReleaseParams } from './orders-api';

const PAGE_SIZE = 50;

type TabKey = 'ACTIVE' | 'expiring' | 'overdue' | 'CONSUMED' | 'CANCELLED' | 'all';
const TABS: { key: TabKey; label: string; params: ReleaseParams }[] = [
  { key: 'ACTIVE', label: 'Ativas', params: { status: ['ACTIVE'] } },
  { key: 'expiring', label: `Vencem em ${RELEASE_EXPIRING_DAYS} dias`, params: { validity: 'expiring' } },
  { key: 'overdue', label: 'Validade vencida', params: { validity: 'overdue' } },
  { key: 'CONSUMED', label: 'Consumidas', params: { status: ['CONSUMED'] } },
  { key: 'CANCELLED', label: 'Canceladas', params: { status: ['CANCELLED'] } },
  { key: 'all', label: 'Todas', params: {} },
];

const TONE: Record<ReleaseStatus, 'primary' | 'success' | 'neutral' | 'danger'> = { ACTIVE: 'primary', CONSUMED: 'success', EXPIRED: 'neutral', CANCELLED: 'danger' };

export function ReleaseStatusBadge({ status, overdue }: { status: ReleaseStatus; overdue?: boolean }) {
  if (overdue) {
    return (
      <Badge tone="warning" size="sm">
        <AlarmClock className="size-3" /> Validade vencida
      </Badge>
    );
  }
  return (
    <Badge tone={TONE[status]} size="sm">
      {RELEASE_STATUS_LABELS[status]}
    </Badge>
  );
}

/** Todas as liberações das ordens visíveis, com saldo ativo, validade e cancelamento. */
export function ReleasesPage() {
  const [tab, setTab] = useState<TabKey>('ACTIVE');
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [cancelling, setCancelling] = useState<CancelReleaseTarget | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      setQ(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const current = TABS.find((t) => t.key === tab)!;
  const list = useReleases({ ...current.params, q: q || undefined, page, pageSize: PAGE_SIZE });
  const summary = useReleasesSummary();
  const s = summary.data;
  const items = list.data?.items ?? [];
  const total = list.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const activeQty = s ? Object.entries(s.activeQtyByUnit).map(([unit, qty]) => formatQty(qty, unit)).join(' · ') || '—' : null;

  const select = (key: TabKey) => {
    setTab(key);
    setPage(1);
  };

  const openCancel = (r: ReleaseListItem) =>
    setCancelling({ orderId: r.order.id, orderNumber: r.order.number, orderVersion: r.order.version, releaseId: r.id, sequence: r.sequence, quantity: r.quantity, unit: r.unit });

  return (
    <div className="mx-auto flex max-w-[1800px] flex-col gap-5 px-4 py-6 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <span className="grid size-11 place-items-center rounded-xl bg-primary-soft text-primary">
            <PackageCheck className="size-5" />
          </span>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Liberações</h1>
            <p className="text-sm text-muted">Quantidades liberadas para carregamento em todas as ordens. Novas liberações são criadas no detalhe da ordem.</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          { key: 'ACTIVE' as const, label: 'Ativas', value: s?.active, extra: activeQty, tone: 'text-primary' },
          { key: 'expiring' as const, label: `Vencem em ${RELEASE_EXPIRING_DAYS} dias`, value: s?.expiring, tone: s?.expiring ? 'text-warning' : '' },
          { key: 'overdue' as const, label: 'Validade vencida', value: s?.overdue, tone: s?.overdue ? 'text-danger' : '' },
          { key: 'CANCELLED' as const, label: 'Canceladas', value: s?.cancelled, tone: '' },
        ].map((k) => (
          <button
            key={k.key}
            onClick={() => select(k.key)}
            className={cn('rounded-lg bg-surface p-3 text-left shadow-sm ring-1 ring-border/60 transition hover:-translate-y-px hover:shadow-md', tab === k.key && 'ring-primary/40')}
          >
            <div className="text-xs font-medium text-muted">{k.label}</div>
            {k.value === undefined ? <Skeleton className="mt-2 h-7 w-12" /> : <div className={cn('mt-1 text-2xl font-semibold tabular', k.tone)}>{k.value}</div>}
            {k.extra ? <div className="truncate text-xs text-subtle tabular">{k.extra}</div> : null}
          </button>
        ))}
      </div>

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-border/70 p-3">
          <div className="-mx-1 flex min-w-0 flex-1 items-center gap-1 overflow-x-auto px-1" role="tablist" aria-label="Situação">
            {TABS.map((t) => (
              <button
                key={t.key}
                role="tab"
                aria-selected={tab === t.key}
                onClick={() => select(t.key)}
                className={cn('flex h-8 shrink-0 items-center rounded-full px-3 text-[13px] font-medium', tab === t.key ? 'bg-primary-soft text-primary ring-1 ring-primary/20' : 'text-muted hover:bg-surface-2 hover:text-text')}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="relative w-full sm:w-64">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Número da ordem…" className="pl-9" aria-label="Buscar por ordem" />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-225 border-separate border-spacing-0 text-[13.5px]">
            <thead>
              <tr className="text-left text-[11.5px] font-semibold uppercase tracking-wider text-muted">
                {['Ordem', 'Fazenda · Comprador', 'Commodity', 'Quantidade', 'Validade', 'Situação', 'Registro', ''].map((h, i) => (
                  <th key={i} className={cn('h-10 border-b border-border bg-surface-2/95 px-4', h === 'Quantidade' && 'text-right')}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {list.isLoading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: 8 }).map((__, j) => (
                      <td key={j} className="h-12 border-b border-border/60 px-4">
                        <Skeleton className="h-4 w-full max-w-32" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : !items.length ? (
                <tr>
                  <td colSpan={8}>
                    <EmptyState icon={<PackageCheck />} title="Nenhuma liberação" description={q ? 'Nenhuma ordem com esse número nesta situação.' : 'Nada nesta situação.'} />
                  </td>
                </tr>
              ) : (
                items.map((r) => (
                  <tr key={r.id} className={cn('align-top transition-colors hover:bg-primary-soft/20', list.isPlaceholderData && 'opacity-60')}>
                    <td className="border-b border-border/60 px-4 py-3">
                      <Link href={`/ordens/${r.order.id}`} className="font-mono font-medium text-primary hover:underline">
                        {r.order.number}
                      </Link>
                      <div className="text-xs text-subtle">
                        Liberação {String(r.sequence).padStart(2, '0')} · v{r.orderVersion}
                      </div>
                    </td>
                    <td className="border-b border-border/60 px-4 py-3">
                      <div className="truncate">{r.farm?.name ?? '—'}</div>
                      <div className="truncate text-xs text-muted">{r.buyer?.name ?? '—'}</div>
                    </td>
                    <td className="border-b border-border/60 px-4 py-3">{r.commodity?.name ?? '—'}</td>
                    <td className="border-b border-border/60 px-4 py-3 text-right font-medium tabular">{formatQty(r.quantity, r.unit)}</td>
                    <td className={cn('whitespace-nowrap border-b border-border/60 px-4 py-3', r.overdue && 'font-medium text-danger')}>{r.validUntil ? formatDate(r.validUntil) : 'Sem validade'}</td>
                    <td className="border-b border-border/60 px-4 py-3">
                      <ReleaseStatusBadge status={r.status} overdue={r.overdue} />
                      {r.status === 'CANCELLED' && r.cancelReason ? <div className="mt-1 max-w-56 text-xs text-muted">{r.cancelReason}</div> : null}
                    </td>
                    <td className="border-b border-border/60 px-4 py-3 text-xs text-muted">
                      <div>
                        {formatDateTime(r.createdAt)}
                        {r.createdBy ? ` · ${r.createdBy}` : ''}
                      </div>
                      {r.cancelledAt ? (
                        <div className="text-danger/90">
                          Cancelada {formatDateTime(r.cancelledAt)}
                          {r.cancelledBy ? ` · ${r.cancelledBy}` : ''}
                        </div>
                      ) : null}
                    </td>
                    <td className="w-12 border-b border-border/60 px-2 py-2.5 text-right">
                      {r.cancellable ? (
                        <Button variant="ghost" size="sm" onClick={() => openCancel(r)} aria-label={`Cancelar liberação ${r.sequence} da ordem ${r.order.number}`}>
                          <PackageX /> Cancelar
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-border/70 px-4 py-2.5 text-[13px] text-muted">
          <span className="tabular">{total ? `${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, total)} de ${total}` : '0 resultados'}</span>
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

      <CancelReleaseDialog target={cancelling} onClose={() => setCancelling(null)} />
    </div>
  );
}
