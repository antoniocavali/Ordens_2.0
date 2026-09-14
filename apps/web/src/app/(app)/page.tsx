'use client';

import type { OrdersSummary } from '@ordens/contracts';
import { Button, Card, Skeleton } from '@ordens/ui';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, EyeOff, FileClock, PackageCheck, Scale, Truck } from 'lucide-react';
import Link from 'next/link';
import { KpiCard } from '@/features/orders/kpi';
import { get } from '@/lib/api';
import { formatQtyCompact } from '@/lib/format';
import { useCan, useMe } from '@/lib/session';

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
}

export default function HomePage() {
  const { data: me } = useMe();
  const can = useCan();
  const summary = useQuery({ queryKey: ['orders', 'summary'], queryFn: () => get<OrdersSummary>('/orders/summary'), enabled: can('order.read') });
  const s = summary.data;
  const scope = me?.activeMembership?.scope;

  return (
    <div className="mx-auto max-w-[1600px] space-y-6 px-4 py-6 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-muted">{me?.activeMembership?.organization.name}</p>
          <h1 className="text-2xl font-semibold tracking-tight">
            {greeting()}, {me?.user.name.split(' ')[0]}
          </h1>
        </div>
        <Button asChild variant="outline">
          <Link href="/ordens">
            Abrir central de ordens <ArrowRight />
          </Link>
        </Button>
      </div>

      {scope === 'MATRIZ' && s ? (
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between border-b border-border/70 px-5 py-3">
            <h2 className="text-sm font-semibold">Precisa da sua atenção</h2>
            <span className="text-xs text-subtle">Atualizado agora</span>
          </div>
          <div className="grid divide-y divide-border/70 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
            <AttentionItem href="/ordens?farmSignal=OVERDUE" icon={<EyeOff />} tone="danger" value={s.awaitingFarmView} label="OCs aguardando visualização da Fazenda" />
            <AttentionItem href="/ordens?buyerSignal=OVERDUE" icon={<EyeOff />} tone="warning" value={s.awaitingBuyerView} label="OCs aguardando visualização do Comprador" />
            <AttentionItem href="/ordens?status=DRAFT" icon={<FileClock />} tone="primary" value={s.draft} label="Rascunhos não publicados" />
          </div>
        </Card>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {summary.isLoading || !s ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[112px] rounded-lg" />)
        ) : (
          <>
            <KpiCard label="Ordens abertas" value={s.open} hint={`${s.publishedToday} publicadas hoje`} icon={<PackageCheck />} />
            <KpiCard label="Volume em ordens" value={formatQtyCompact(s.totalQty, 't')} hint={`${formatQtyCompact(s.releasedQty, 't')} liberadas`} icon={<Scale />} />
            <KpiCard label="Carregado" value={formatQtyCompact(s.loadedQty, 't')} hint={`${formatQtyCompact(s.receivedQty, 't')} recebidas`} icon={<Truck />} progress={{ value: s.loadedQty, total: s.totalQty }} />
            <KpiCard label="Saldo a carregar" value={formatQtyCompact(s.balanceQty, 't')} hint="Quantidade − carregado − cancelado" icon={<Scale />} />
          </>
        )}
      </div>

      <Card className="p-6">
        <p className="text-sm text-muted">
          A Central de Controle completa (funil de volumes, cargas do dia, performance de transportadoras e exceções operacionais) chega na fase de
          dashboards, alimentada pelos módulos de agendamento, cargas e documentos.
        </p>
      </Card>
    </div>
  );
}

function AttentionItem({ href, icon, value, label, tone }: { href: string; icon: React.ReactNode; value: number; label: string; tone: 'danger' | 'warning' | 'primary' }) {
  const toneCls = { danger: 'bg-danger-soft text-danger', warning: 'bg-warning-soft text-warning', primary: 'bg-primary-soft text-primary' }[tone];
  return (
    <Link href={href} className="group flex items-center gap-4 px-5 py-4 transition hover:bg-surface-2/60">
      <span className={`grid size-10 place-items-center rounded-lg [&_svg]:size-5 ${toneCls}`}>{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-xl font-semibold tabular">{value}</span>
        <span className="block truncate text-[13px] text-muted">{label}</span>
      </span>
      <ArrowRight className="size-4 text-subtle transition group-hover:translate-x-0.5 group-hover:text-text" />
    </Link>
  );
}
