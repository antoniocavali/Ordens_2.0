'use client';

import { LOAD_STAGES, type LoadDto } from '@ordens/contracts';
import { Card, cn, EmptyState, Input, Skeleton } from '@ordens/ui';
import { Search, Truck } from 'lucide-react';
import { motion } from 'motion/react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { formatDate, formatQty, formatRelative } from '@/lib/format';
import { Plates } from './fleet-fields';
import { LoadDrawer } from './load-drawer';
import { LoadStatusBadge } from './load-status';
import { useLoads } from './logistics-api';

interface Tab {
  key: string;
  label: string;
  statuses?: string[];
  /** Carregamento previsto até esta data (atrasadas). */
  late?: boolean;
}

const PRE_LOADING = ['SCHEDULED', 'CONFIRMED', 'AWAITING_LOADING', 'LOADING'];

/** Abas da tela; a chave vai para a URL (`?etapa=`), usada pelos links do painel. */
const TABS: Tab[] = [
  { key: 'all', label: 'Todas' },
  ...LOAD_STAGES.map((s) => ({ key: s.key, label: s.label, statuses: [...s.statuses] as string[] })),
  { key: 'documentacao', label: 'Aguardando documentação fiscal', statuses: ['AWAITING_FARM_INVOICE'] },
  { key: 'atrasadas', label: 'Atrasadas', statuses: PRE_LOADING, late: true },
  { key: 'done', label: 'Concluídas', statuses: ['COMPLETED'] },
  { key: 'cancelled', label: 'Canceladas', statuses: ['CANCELLED'] },
];

const localToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
const yesterday = () => new Date(new Date(`${localToday()}T00:00:00Z`).getTime() - 86_400_000).toISOString().slice(0, 10);

export function LoadsPage({ orderId, embedded }: { orderId?: string; embedded?: boolean }) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const initialTab = TABS.some((t) => t.key === params.get('etapa')) ? params.get('etapa')! : 'all';
  const [tab, setTabState] = useState(embedded ? 'all' : initialTab);
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [openId, setOpenId] = useState<string | null>(params.get('abrir'));

  // Navegação pelo painel ou pelo histórico do navegador troca a aba.
  useEffect(() => {
    if (embedded) return;
    const etapa = params.get('etapa');
    setTabState(TABS.some((t) => t.key === etapa) ? etapa! : 'all');
  }, [params, embedded]);

  const setTab = (key: string) => {
    setTabState(key);
    if (embedded) return;
    const next = new URLSearchParams(params.toString());
    if (key === 'all') next.delete('etapa');
    else next.set('etapa', key);
    router.replace(next.size ? `${pathname}?${next}` : pathname, { scroll: false });
  };

  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const current = TABS.find((t) => t.key === tab)!;
  const lateUntil = useMemo(() => yesterday(), []);
  const list = useLoads({ q: q || undefined, orderId, status: current.statuses, to: current.late ? lateUntil : undefined, pageSize: 200 });
  const all = useLoads({ orderId, pageSize: 200 });
  const counts = Object.fromEntries(
    TABS.map((t) => [
      t.key,
      t.statuses
        ? (all.data?.items ?? []).filter((l) => t.statuses!.includes(l.status) && (!t.late || (l.loadingDate !== null && l.loadingDate <= lateUntil))).length
        : (all.data?.total ?? 0),
    ]),
  );
  const items = list.data?.items ?? [];
  const tabs = embedded ? TABS.filter((t) => t.key !== 'atrasadas') : TABS;

  const body = (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-border/70 p-3">
        <div className="-mx-1 flex flex-1 items-center gap-1 overflow-x-auto px-1" role="tablist" aria-label="Etapa da carga">
          {tabs.map((t) => (
            <button
              key={t.key}
              role="tab"
              aria-selected={tab === t.key}
              onClick={() => setTab(t.key)}
              className={cn(
                'relative flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium',
                tab === t.key ? 'text-primary' : 'text-muted hover:bg-surface-2 hover:text-text',
                t.key === 'atrasadas' && (counts[t.key] ?? 0) > 0 && tab !== t.key && 'text-danger',
              )}
            >
              {tab === t.key ? <motion.span layoutId={`loads-tab-${orderId ?? 'all'}`} className="absolute inset-0 rounded-full bg-primary-soft ring-1 ring-primary/20" /> : null}
              <span className="relative">{t.label}</span>
              <span className="relative rounded-full bg-surface-3 px-1.5 text-[11px] tabular">{counts[t.key] ?? 0}</span>
            </button>
          ))}
        </div>
        {!embedded ? (
          <div className="relative w-full sm:w-72">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Número da carga ou placa…" className="pl-9" aria-label="Buscar cargas" />
          </div>
        ) : null}
      </div>
      {list.isLoading ? (
        <div className="space-y-2 p-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-12" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={<Truck />}
          title="Nenhuma carga"
          description={embedded ? 'As cargas surgem ao converter agendamentos ou ao registrar uma carga direta.' : tab === 'all' ? 'Ajuste a busca.' : `Nada em "${current.label}".`}
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-[13.5px]">
            <thead>
              <tr className="border-b border-border bg-surface-2/80 text-left text-[11.5px] uppercase tracking-wider text-muted">
                <th className="h-10 px-4">Carga</th>
                {!orderId ? <th className="px-4">Ordem · origem → destino</th> : null}
                <th className="px-4">Veículo</th>
                <th className="px-4">Motorista</th>
                <th className="px-4 text-right">Previsto</th>
                <th className="px-4 text-right">Líquido</th>
                <th className="px-4">Status</th>
                <th className="px-4">Atualização</th>
              </tr>
            </thead>
            <tbody>
              {items.map((l: LoadDto) => (
                <tr key={l.id} tabIndex={0} onClick={() => setOpenId(l.id)} onKeyDown={(e) => e.key === 'Enter' && setOpenId(l.id)} className="cursor-pointer border-b border-border/60 outline-none hover:bg-primary-soft/30 focus-visible:bg-primary-soft/40">
                  <td className="h-14 px-4">
                    <div className="font-mono text-[13px] font-medium">{l.number}</div>
                    <div className={cn('text-[11px] text-subtle', current.late && 'font-medium text-danger')}>{l.loadingDate ? formatDate(l.loadingDate) : 'sem data'}</div>
                  </td>
                  {!orderId ? (
                    <td className="max-w-72 px-4">
                      <div className="font-mono text-xs">{l.order.number}</div>
                      <div className="truncate text-xs text-muted">
                        {l.order.farm} → {l.order.buyer}
                      </div>
                    </td>
                  ) : null}
                  <td className="px-4">
                    <Plates plates={l.plates} />
                  </td>
                  <td className="px-4">
                    <div className="truncate">{l.driver?.name ?? <span className="text-subtle">A definir</span>}</div>
                    <div className="truncate text-[11px] text-subtle">{l.carrier?.name ?? ''}</div>
                  </td>
                  <td className="px-4 text-right tabular">{formatQty(l.expectedQty, l.order.unit)}</td>
                  <td className="px-4 text-right tabular">{l.netKg ? formatQty(l.netKg, 'kg') : '—'}</td>
                  <td className="px-4">
                    <LoadStatusBadge status={l.status} />
                  </td>
                  <td className="px-4 text-xs text-muted">{formatRelative(l.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );

  return (
    <>
      {embedded ? (
        body
      ) : (
        <div className="mx-auto flex max-w-[1800px] flex-col gap-5 px-4 py-6 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3.5">
            <span className="grid size-11 place-items-center rounded-xl bg-primary-soft text-primary">
              <Truck className="size-5" />
            </span>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">Cargas</h1>
              <p className="text-sm text-muted">Carregamentos físicos de cada ordem: frota, pesagem, documentação fiscal, transporte e recebimento.</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            {LOAD_STAGES.map((s) => (
              <button key={s.key} onClick={() => setTab(s.key)} className={cn('rounded-lg bg-surface p-3 text-left shadow-sm ring-1 ring-border/60 transition hover:-translate-y-px hover:shadow-md', tab === s.key && 'ring-2 ring-primary')}>
                <div className="text-xs font-medium text-muted">{s.label}</div>
                <div className="mt-1 text-2xl font-semibold tabular">{counts[s.key] ?? 0}</div>
              </button>
            ))}
          </div>
          {body}
        </div>
      )}
      <LoadDrawer id={openId} onClose={() => setOpenId(null)} />
    </>
  );
}
