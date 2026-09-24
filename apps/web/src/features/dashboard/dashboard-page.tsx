'use client';

import { DASHBOARD_PERIOD_LABELS, DASHBOARD_PERIODS, type AttentionItem, type BuyerDashboard, type DashboardDto, type DashboardPeriod } from '@ordens/contracts';
import { AsyncCombobox, Button, Card, cn, Skeleton, type ComboOption } from '@ordens/ui';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  AlarmClock,
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  EyeOff,
  FileClock,
  FileWarning,
  FileX,
  Inbox,
  PackageCheck,
  Scale,
  ShieldAlert,
  TrendingUp,
  Truck,
  Undo2,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { motion } from 'motion/react';
import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { KpiCard } from '@/features/orders/kpi';
import { lookups } from '@/features/orders/orders-api';
import { get } from '@/lib/api';
import { formatMoney, formatQtyCompact, formatRelative } from '@/lib/format';
import { useMe } from '@/lib/session';
import { DailyChart, FunnelChart, ProgressList } from './charts';

const ATTENTION_ICON: Record<string, LucideIcon> = {
  farm_view_overdue: EyeOff,
  buyer_view_overdue: EyeOff,
  farm_view_pending: EyeOff,
  buyer_view_pending: EyeOff,
  late_loads: AlarmClock,
  rejected_invoices: FileX,
  divergent_invoices: FileWarning,
  awaiting_invoice: FileClock,
  over_tolerance: Scale,
  occurrences_overdue: AlarmClock,
  occurrences_severe: ShieldAlert,
  occurrences_open: ShieldAlert,
  appointments_without_carrier: CalendarClock,
  appointments_today: CalendarClock,
  documents_blocked: FileX,
  drafts: FileClock,
  in_transit: Truck,
  pending_billing: Inbox,
  buyer_pending_billing: Inbox,
  buyer_returned: Undo2,
};

const TONE: Record<AttentionItem['tone'], string> = {
  danger: 'bg-danger-soft text-danger',
  warning: 'bg-warning-soft text-warning',
  info: 'bg-info-soft text-info',
  primary: 'bg-primary-soft text-primary',
};

function formatHours(h: number) {
  if (h < 1) return 'menos de 1 h';
  if (h < 48) return `${h.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} h`;
  return `${(h / 24).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} dias`;
}

/** Portal do Comprador: onde estão as próprias solicitações (Q41). */
function BuyerRequests({ data, periodLabel }: { data: BuyerDashboard; periodLabel: string }) {
  const r = data.requests;
  const rows: { label: string; count: number; href: string; tone: string; icon: LucideIcon }[] = [
    { label: 'Rascunhos', count: r.draft, href: '/ordens?status=DRAFT', tone: 'bg-surface-3 text-muted', icon: FileClock },
    { label: 'Devolvidas para ajuste', count: r.returned, href: '/ordens?status=DRAFT', tone: 'bg-danger-soft text-danger', icon: Undo2 },
    { label: 'Aguardando faturamento', count: r.pendingBilling, href: '/ordens?status=PENDING_BILLING', tone: 'bg-warning-soft text-warning', icon: Inbox },
    { label: `Publicadas ${periodLabel}`, count: r.publishedInPeriod, href: '/ordens', tone: 'bg-success-soft text-success', icon: CheckCircle2 },
    { label: `Canceladas ${periodLabel}`, count: r.cancelledInPeriod, href: '/ordens?status=CANCELLED', tone: 'bg-surface-3 text-subtle', icon: FileX },
  ];
  return (
    <div className="space-y-4">
      <ul className="space-y-1">
        {rows.map((row) => (
          <li key={row.label}>
            <Link href={row.href} className="group flex items-center gap-3 rounded-md px-2 py-2 text-sm transition hover:bg-surface-2">
              <span className={cn('grid size-7 place-items-center rounded-md [&_svg]:size-4', row.tone)}>
                <row.icon />
              </span>
              <span className="flex-1 text-muted group-hover:text-text">{row.label}</span>
              <span className="font-semibold tabular">{row.count}</span>
            </Link>
          </li>
        ))}
      </ul>
      <div className="flex items-center justify-between rounded-md bg-primary-soft/60 px-3 py-2.5 text-sm">
        <span className="text-muted">Tempo médio até a publicação</span>
        <span className="font-semibold text-primary">{data.avgHoursToPublish === null ? '—' : formatHours(data.avgHoursToPublish)}</span>
      </div>
    </div>
  );
}

function Inbound({ items }: { items: BuyerDashboard['inbound'] }) {
  if (!items.length) return <p className="py-6 text-center text-sm text-subtle">Nenhuma carga a caminho.</p>;
  return (
    <ul className="divide-y divide-border/60">
      {items.map((l) => (
        <li key={l.id}>
          <Link href={`/cargas?abrir=${l.id}`} className="flex items-center gap-3 py-2.5 text-sm transition hover:bg-surface-2/60">
            <span className="grid size-8 shrink-0 place-items-center rounded-md bg-info-soft text-info">
              <Truck className="size-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">
                <span className="font-mono">{l.plates[0] ?? l.number}</span>
                <span className="text-muted"> · {l.carrier ?? 'Transportadora não informada'}</span>
              </span>
              <span className="block truncate text-xs text-subtle">
                OC {l.orderNumber} · {[l.commodity, l.farm].filter(Boolean).join(' · ')}
              </span>
            </span>
            <span className="text-right">
              <span className="block font-semibold tabular">{formatQtyCompact(l.quantityT, 't')}</span>
              <span className="block text-xs text-subtle">{l.status === 'ARRIVED' ? 'No destino' : l.since ? `saiu ${formatRelative(l.since)}` : 'Em trânsito'}</span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
}

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

function Attention({ items }: { items: AttentionItem[] }) {
  const pending = items.filter((i) => i.count > 0);
  if (!pending.length) {
    return (
      <Card className="flex items-center gap-4 p-5">
        <span className="grid size-10 place-items-center rounded-lg bg-success-soft text-success">
          <CheckCircle2 className="size-5" />
        </span>
        <div>
          <div className="font-semibold">Tudo em dia</div>
          <div className="text-sm text-muted">Nenhuma pendência nas {items.length} verificações do seu perfil.</div>
        </div>
      </Card>
    );
  }
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between border-b border-border/70 px-5 py-3">
        <h2 className="text-sm font-semibold">Precisa da sua atenção</h2>
        <span className="text-xs text-subtle">
          {pending.length} de {items.length} verificações com pendência
        </span>
      </div>
      <div className="grid sm:grid-cols-2 xl:grid-cols-3">
        {pending.map((item, i) => {
          const Icon = ATTENTION_ICON[item.key] ?? ShieldAlert;
          return (
            <motion.div key={item.key} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }} className="border-b border-border/60 sm:border-r">
              <Link href={item.href} className="group flex items-center gap-4 px-5 py-4 transition hover:bg-surface-2/60">
                <span className={cn('grid size-10 shrink-0 place-items-center rounded-lg [&_svg]:size-5', TONE[item.tone])}>
                  <Icon />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-xl font-semibold tabular">{item.count}</span>
                  <span className="block truncate text-[13px] text-muted">{item.label}</span>
                </span>
                <ArrowRight className="size-4 shrink-0 text-subtle transition group-hover:translate-x-0.5 group-hover:text-text" />
              </Link>
            </motion.div>
          );
        })}
      </div>
    </Card>
  );
}

export function DashboardPage() {
  const { data: me } = useMe();
  const [period, setPeriod] = useState<DashboardPeriod>('7d');
  const [commodity, setCommodity] = useState<ComboOption | null>(null);
  const scope = me?.activeMembership?.scope;
  const enabled = scope === 'MATRIZ' || scope === 'FARM' || scope === 'BUYER';

  const dashboard = useQuery({
    queryKey: ['dashboard', period, commodity?.id ?? null],
    queryFn: ({ signal }) => get<DashboardDto>('/dashboard', { period, commodityId: commodity?.id }, signal),
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
    enabled,
  });
  const d = dashboard.data;
  const isMatriz = d?.scope === 'MATRIZ';
  const periodLabel = period === 'today' ? 'hoje' : `nos últimos ${period === '7d' ? '7' : '30'} dias`;

  return (
    <div className="mx-auto max-w-[1600px] space-y-5 px-4 py-6 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-muted">{me?.activeMembership?.organization.name}</p>
          <h1 className="text-2xl font-semibold tracking-tight">
            {greeting()}, {me?.user.name.split(' ')[0]}
          </h1>
        </div>
        {enabled ? (
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
            <div className="flex items-center rounded-lg bg-surface p-1 ring-1 ring-border" role="radiogroup" aria-label="Período">
              {DASHBOARD_PERIODS.map((p) => (
                <button
                  key={p}
                  role="radio"
                  aria-checked={period === p}
                  onClick={() => setPeriod(p)}
                  className={cn('relative h-8 rounded-md px-3 text-[13px] font-medium', period === p ? 'text-primary' : 'text-muted hover:text-text')}
                >
                  {period === p ? <motion.span layoutId="dash-period" className="absolute inset-0 rounded-md bg-primary-soft" /> : null}
                  <span className="relative">{DASHBOARD_PERIOD_LABELS[p]}</span>
                </button>
              ))}
            </div>
            <div className="w-full sm:w-60">
              <AsyncCombobox value={commodity} onChange={setCommodity} queryKey={['lookup', 'commodities']} fetchPage={lookups.commodities()} placeholder="Todas as commodities" aria-label="Commodity" />
            </div>
            <Button asChild variant="outline">
              <Link href="/ordens">
                Ordens <ArrowRight />
              </Link>
            </Button>
          </div>
        ) : null}
      </div>

      {!enabled ? (
        <Card className="p-6 text-sm text-muted">Selecione uma organização para ver o painel.</Card>
      ) : !d ? (
        <div className="space-y-4">
          <Skeleton className="h-28 rounded-lg" />
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-[112px] rounded-lg" />
            ))}
          </div>
          <Skeleton className="h-72 rounded-lg" />
        </div>
      ) : (
        <div className={cn('space-y-5 transition-opacity', dashboard.isFetching && dashboard.isPlaceholderData && 'opacity-60')}>
          <Attention items={d.attention} />

          <div className={cn('grid gap-4 sm:grid-cols-2', isMatriz ? 'xl:grid-cols-5' : 'xl:grid-cols-4')}>
            <KpiCard label="Ordens abertas" value={d.kpis.openOrders} hint={`${d.kpis.publishedInPeriod} publicadas ${periodLabel}`} icon={<PackageCheck />} />
            <KpiCard
              label="Carregado"
              value={formatQtyCompact(d.kpis.loadedT, 't')}
              hint={`de ${formatQtyCompact(d.kpis.orderedT, 't')} em ordens`}
              icon={<Truck />}
              progress={{ value: d.kpis.loadedT, total: d.kpis.orderedT }}
            />
            <KpiCard label="Em trânsito" value={formatQtyCompact(d.kpis.inTransitT, 't')} hint={`${formatQtyCompact(d.kpis.receivedT, 't')} recebidas`} icon={<TrendingUp />} tone="success" />
            <KpiCard label="Saldo a carregar" value={formatQtyCompact(d.kpis.balanceT, 't')} hint={`${formatQtyCompact(d.kpis.releasedT, 't')} liberadas`} icon={<Scale />} tone="warning" />
            {isMatriz && d.kpis.loadedValue !== null ? (
              <KpiCard label="Valor carregado" value={formatMoney(d.kpis.loadedValue, 'BRL', true)} hint="Ordens em BRL" icon={<Wallet />} />
            ) : null}
          </div>

          <div className="grid gap-4 lg:grid-cols-5">
            <Panel title="Funil de volume" className="lg:col-span-3" action={<span className="text-xs text-subtle">toneladas · ordens ativas</span>}>
              <FunnelChart steps={d.funnel} />
            </Panel>
            {d.buyer ? (
              <Panel title="Minhas solicitações" className="lg:col-span-2" action={<Link href="/ordens" className="text-xs text-primary hover:underline">Ver todas</Link>}>
                <BuyerRequests data={d.buyer} periodLabel={periodLabel} />
              </Panel>
            ) : (
            <Panel title="Cargas de hoje" className="lg:col-span-2" action={<span className="text-xs tabular text-subtle">{d.loadsToday.total} no dia</span>}>
              {d.loadsToday.total === 0 ? (
                <p className="py-8 text-center text-sm text-subtle">Nenhuma carga com carregamento previsto para hoje.</p>
              ) : (
                <ul className="space-y-2.5">
                  {d.loadsToday.stages.map((s) => (
                    <li key={s.key} className="flex items-center gap-3 text-sm">
                      <span className="w-28 text-muted">{s.label}</span>
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-3">
                        <motion.div className="h-full rounded-full bg-primary" initial={{ width: 0 }} animate={{ width: `${(s.count / d.loadsToday.total) * 100}%` }} />
                      </div>
                      <span className="w-8 text-right font-semibold tabular">{s.count}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
            )}
          </div>

          <div className="grid gap-4 lg:grid-cols-5">
            <Panel title={`Evolução ${period === '30d' ? 'dos últimos 30 dias' : 'dos últimos 7 dias'}`} className="lg:col-span-3">
              <DailyChart points={d.daily} />
            </Panel>
            <Panel title="Por commodity" className="lg:col-span-2" action={<span className="text-xs text-subtle">carregado / em ordens</span>}>
              <ProgressList rows={d.byCommodity.map((c) => ({ id: c.id, label: c.name, value: c.loadedT, total: c.orderedT }))} empty="Sem ordens ativas." />
            </Panel>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="Maiores saldos a carregar" action={<span className="text-xs text-subtle">atualizado {formatRelative(d.generatedAt)}</span>}>
              <ProgressList
                rows={d.activeOrders.map((o) => ({ id: o.id, label: o.number, sublabel: [o.commodity, o.counterpart].filter(Boolean).join(' · '), value: o.loadedT, total: o.orderedT, href: `/ordens/${o.id}` }))}
                empty="Nenhuma ordem em andamento."
              />
            </Panel>
            {isMatriz ? (
              <Panel title="Transportadoras" action={<span className="text-xs text-subtle">cargas {period === '30d' ? 'em 30 dias' : 'em 7 dias'}</span>}>
                {d.carriers.length === 0 ? (
                  <p className="py-6 text-center text-sm text-subtle">Sem cargas com transportadora no período.</p>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs uppercase tracking-wider text-muted">
                        <th className="pb-2">Transportadora</th>
                        <th className="pb-2 text-right">Cargas</th>
                        <th className="pb-2 text-right">Volume</th>
                        <th className="pb-2 text-right">Divergências</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.carriers.map((c) => (
                        <tr key={c.name} className="border-t border-border/60">
                          <td className="py-2.5 pr-3 font-medium">{c.name}</td>
                          <td className="py-2.5 text-right tabular">{c.loads}</td>
                          <td className="py-2.5 text-right tabular">{formatQtyCompact(c.loadedT, 't')}</td>
                          <td className={cn('py-2.5 text-right tabular', c.divergentLoads > 0 && 'font-medium text-warning')}>{c.divergentLoads}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </Panel>
            ) : d.buyer ? (
              <Panel title="A caminho" action={<span className="text-xs tabular text-subtle">{d.buyer.inbound.length} cargas</span>}>
                <Inbound items={d.buyer.inbound} />
              </Panel>
            ) : (
              <Panel title="Volumes">
                <dl className="grid grid-cols-2 gap-4 text-sm">
                  {[
                    ['Em ordens', d.kpis.orderedT],
                    ['Liberado', d.kpis.releasedT],
                    ['Agendado', d.kpis.scheduledT],
                    ['Carregado', d.kpis.loadedT],
                    ['Em trânsito', d.kpis.inTransitT],
                    ['Recebido', d.kpis.receivedT],
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-md bg-surface-2 px-3 py-2.5">
                      <dt className="text-xs text-muted">{label}</dt>
                      <dd className="text-lg font-semibold tabular">{formatQtyCompact(value!, 't')}</dd>
                    </div>
                  ))}
                </dl>
              </Panel>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
