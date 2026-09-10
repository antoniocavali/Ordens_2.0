'use client';

import { Button, Card, Drawer, Skeleton } from '@ordens/ui';
import { ArrowUpRight, CalendarRange, Factory, MapPin, PackageCheck, Pencil } from 'lucide-react';
import Link from 'next/link';
import { useEffect } from 'react';
import { formatDate, formatMoney, formatQty } from '@/lib/format';
import { useMe } from '@/lib/session';
import { Farol, QuantityBar, StatusBadge } from './indicators';
import { registerView, useInvalidateOrders, useOrder, useTimeline } from './orders-api';
import { Timeline } from './timeline';

export function QuickView({ orderId, onClose, onEdit, onRelease }: { orderId: string | null; onClose: () => void; onEdit: (id: string) => void; onRelease: (id: string) => void }) {
  const order = useOrder(orderId);
  const timeline = useTimeline(orderId);
  const { data: me } = useMe();
  const invalidate = useInvalidateOrders();
  const o = order.data;
  const external = me?.activeMembership?.scope !== 'MATRIZ';

  // Quick View completo conta como visualização efetiva para Fazenda/Comprador.
  useEffect(() => {
    if (orderId && external) void registerView(orderId).then(() => invalidate());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId, external]);

  return (
    <Drawer
      open={Boolean(orderId)}
      onRequestClose={onClose}
      size="md"
      title={o ? <span className="font-mono">{o.number}</span> : 'Carregando…'}
      subtitle={
        o ? (
          <span className="flex items-center gap-2">
            <StatusBadge status={o.status} size="sm" />
            <span>versão {o.version}</span>
          </span>
        ) : null
      }
      footer={
        o ? (
          <div className="flex items-center gap-2">
            {o.allowedActions.includes('update') ? (
              <Button variant="outline" size="sm" onClick={() => onEdit(o.id)}>
                <Pencil /> Editar
              </Button>
            ) : null}
            {o.allowedActions.includes('release') ? (
              <Button variant="soft" size="sm" onClick={() => onRelease(o.id)}>
                <PackageCheck /> Nova liberação
              </Button>
            ) : null}
            <Button asChild size="sm" className="ml-auto">
              <Link href={`/ordens/${o.id}`}>
                Abrir detalhes <ArrowUpRight />
              </Link>
            </Button>
          </div>
        ) : null
      }
    >
      {!o ? (
        <div className="space-y-4 p-6">
          <Skeleton className="h-20" />
          <Skeleton className="h-32" />
          <Skeleton className="h-48" />
        </div>
      ) : (
        <div className="space-y-5 p-5 sm:p-6">
          <div>
            <div className="text-xl font-semibold tracking-tight">
              {o.commodity?.name ?? 'Commodity não definida'} · {formatQty(o.quantities.total, o.quantities.unit)}
            </div>
            <div className="mt-1 text-sm text-muted">
              {o.seller?.name ?? '—'} → {o.buyer?.name ?? '—'}
              {o.totalValue ? ` · ${formatMoney(o.totalValue, o.currency)}` : ''}
            </div>
          </div>

          <Card className="p-4">
            <QuantityBar q={o.quantities} showLegend />
            <div className="mt-3 flex items-baseline justify-between border-t border-border/60 pt-3">
              <span className="text-xs text-muted">Saldo a carregar</span>
              <span className="text-base font-semibold tabular">{formatQty(o.quantities.balance, o.quantities.unit)}</span>
            </div>
          </Card>

          <div className="grid grid-cols-2 gap-3 text-sm">
            <Info icon={<Factory />} label="Fazenda" value={o.farm?.name} />
            <Info icon={<MapPin />} label="Município" value={o.farm?.city ? `${o.farm.city}/${o.farm.state}` : null} />
            <Info icon={<CalendarRange />} label="Janela" value={o.loadingStartsOn ? `${formatDate(o.loadingStartsOn)} – ${formatDate(o.loadingEndsOn)}` : null} />
            <Info icon={<PackageCheck />} label="Liberações" value={`${o.releases.length} · ${formatQty(o.quantities.released, o.quantities.unit)}`} />
          </div>

          {o.status !== 'DRAFT' ? (
            <div className="space-y-2">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-subtle">Faróis de visualização</h4>
              <div className="flex flex-wrap gap-2">
                {me?.activeMembership?.scope !== 'BUYER' ? <Farol side="Fazenda" info={o.farmView} version={o.version} /> : null}
                {me?.activeMembership?.scope !== 'FARM' ? <Farol side="Comprador" info={o.buyerView} version={o.version} /> : null}
              </div>
            </div>
          ) : null}

          <div className="space-y-3">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-subtle">Últimos eventos</h4>
            <Timeline events={timeline.data} loading={timeline.isLoading} limit={6} unit={o.quantities.unit} />
          </div>
        </div>
      )}
    </Drawer>
  );
}

function Info({ icon, label, value }: { icon: React.ReactNode; label: string; value: string | null | undefined }) {
  return (
    <div className="flex items-start gap-2.5 rounded-md bg-surface-2/70 p-3">
      <span className="mt-0.5 text-subtle [&_svg]:size-4">{icon}</span>
      <div className="min-w-0">
        <div className="text-[11px] text-subtle">{label}</div>
        <div className="truncate font-medium">{value || '—'}</div>
      </div>
    </div>
  );
}
