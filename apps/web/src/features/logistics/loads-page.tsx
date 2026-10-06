'use client';

import { LOAD_STAGES, type LoadDto } from '@ordens/contracts';
import { Card, cn, EmptyState, Skeleton } from '@ordens/ui';
import { Truck } from 'lucide-react';
import { motion } from 'motion/react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { formatDate, formatQty, formatRelative } from '@/lib/format';
import { Plates } from './transport-fields';
import { LoadDrawer } from './load-drawer';
import { LoadStatusBadge } from './load-status';
import { useLoads } from './logistics-api';

interface Tab {
  key: string;
  label: string;
  statuses?: string[];
}

const TABS: Tab[] = [
  { key: 'all', label: 'Todas' },
  ...LOAD_STAGES.map((s) => ({ key: s.key, label: s.label, statuses: [...s.statuses] as string[] })),
  { key: 'documentacao', label: 'Aguardando documentação fiscal', statuses: ['AWAITING_FARM_INVOICE'] },
  { key: 'done', label: 'Concluídas', statuses: ['COMPLETED'] },
  { key: 'cancelled', label: 'Canceladas', statuses: ['CANCELLED'] },
];

/**
 * Cargas de uma ordem: um registro por caminhão que chegou à fazenda. Não há tela geral de cargas —
 * elas vivem dentro da ordem, e `?carga=<id>` na URL abre uma delas (links de documentos e avisos).
 */
export function LoadsPage({ orderId }: { orderId: string }) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [tab, setTab] = useState('all');
  const openId = params.get('carga');

  const setOpenId = (id: string | null) => {
    const next = new URLSearchParams(params.toString());
    if (id) next.set('carga', id);
    else next.delete('carga');
    router.replace(next.size ? `${pathname}?${next}` : pathname, { scroll: false });
  };

  const current = TABS.find((t) => t.key === tab)!;
  const all = useLoads({ orderId, pageSize: 200 });
  const rows = all.data?.items ?? [];
  const items = current.statuses ? rows.filter((l) => current.statuses!.includes(l.status)) : rows;
  const counts = Object.fromEntries(TABS.map((t) => [t.key, t.statuses ? rows.filter((l) => t.statuses!.includes(l.status)).length : rows.length]));

  // A aba escolhida pode esvaziar quando a carga avança de etapa: volta para "Todas" em vez de sumir com ela.
  useEffect(() => {
    if (tab !== 'all' && all.data && items.length === 0) setTab('all');
  }, [tab, all.data, items.length]);

  return (
    <>
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-border/70 p-3">
          <div className="-mx-1 flex flex-1 items-center gap-1 overflow-x-auto px-1" role="tablist" aria-label="Etapa da carga">
            {TABS.map((t) => (
              <button
                key={t.key}
                role="tab"
                aria-selected={tab === t.key}
                onClick={() => setTab(t.key)}
                className={cn('relative flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium', tab === t.key ? 'text-primary' : 'text-muted hover:bg-surface-2 hover:text-text')}
              >
                {tab === t.key ? <motion.span layoutId={`loads-tab-${orderId}`} className="absolute inset-0 rounded-full bg-primary-soft ring-1 ring-primary/20" /> : null}
                <span className="relative">{t.label}</span>
                <span className="relative rounded-full bg-surface-3 px-1.5 text-[11px] tabular">{counts[t.key] ?? 0}</span>
              </button>
            ))}
          </div>
        </div>
        {all.isLoading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-12" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <EmptyState icon={<Truck />} title="Nenhuma carga" description="A carga nasce quando a Fazenda informa a chegada do caminhão." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-[13.5px]">
              <thead>
                <tr className="border-b border-border bg-surface-2/80 text-left text-[11.5px] uppercase tracking-wider text-muted">
                  <th className="h-10 px-4">Carga</th>
                  <th className="px-4">Veículo</th>
                  <th className="px-4">Motorista</th>
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
                      <div className="text-[11px] text-subtle">{l.loadingDate ? `chegou em ${formatDate(l.loadingDate)}` : 'sem data'}</div>
                    </td>
                    <td className="px-4">
                      <Plates plates={l.plates} />
                    </td>
                    <td className="px-4">
                      <div className="truncate">{l.driverName ?? <span className="text-subtle">A definir</span>}</div>
                      <div className="truncate text-[11px] text-subtle">{l.carrierName ?? ''}</div>
                    </td>
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
      <LoadDrawer id={openId} onClose={() => setOpenId(null)} />
    </>
  );
}
