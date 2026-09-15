'use client';

import type { OrderPriority, OrderQuantities, OrderStatus, ViewSignal, ViewSignalInfo } from '@ordens/contracts';
import { Badge, cn, Tooltip } from '@ordens/ui';
import { AlertTriangle, CheckCircle2, Eye, EyeOff, FilePen, History, Hourglass, Minus, PauseCircle, Send, Truck, XCircle, type LucideIcon } from 'lucide-react';
import { motion } from 'motion/react';
import { formatDateTime, formatQty, ratio } from '@/lib/format';

const STATUS: Record<OrderStatus, { label: string; tone: 'neutral' | 'primary' | 'info' | 'warning' | 'success' | 'danger'; icon: LucideIcon }> = {
  DRAFT: { label: 'Rascunho', tone: 'neutral', icon: FilePen },
  PENDING_BILLING: { label: 'Aguardando faturamento', tone: 'warning', icon: Hourglass },
  PUBLISHED: { label: 'Publicada', tone: 'primary', icon: Send },
  IN_PROGRESS: { label: 'Em execução', tone: 'info', icon: Truck },
  SUSPENDED: { label: 'Suspensa', tone: 'warning', icon: PauseCircle },
  COMPLETED: { label: 'Concluída', tone: 'success', icon: CheckCircle2 },
  CANCELLED: { label: 'Cancelada', tone: 'danger', icon: XCircle },
};

export const STATUS_OPTIONS = Object.entries(STATUS).map(([value, v]) => ({ value: value as OrderStatus, label: v.label }));

export function StatusBadge({ status, size = 'md' }: { status: OrderStatus; size?: 'sm' | 'md' }) {
  const s = STATUS[status];
  return (
    <Badge tone={s.tone} size={size}>
      <s.icon aria-hidden />
      {s.label}
    </Badge>
  );
}

const PRIORITY: Record<OrderPriority, { label: string; cls: string }> = {
  LOW: { label: 'Baixa', cls: 'bg-subtle/50' },
  NORMAL: { label: 'Normal', cls: 'bg-info/70' },
  HIGH: { label: 'Alta', cls: 'bg-warning' },
  URGENT: { label: 'Urgente', cls: 'bg-danger animate-pulse' },
};

export function PriorityDot({ priority, withLabel }: { priority: OrderPriority; withLabel?: boolean }) {
  const p = PRIORITY[priority];
  return (
    <span className="inline-flex items-center gap-1.5" title={`Prioridade ${p.label.toLowerCase()}`}>
      <span className={cn('size-2 rounded-full', p.cls)} aria-hidden />
      {withLabel ? <span className="text-xs text-muted">{p.label}</span> : <span className="sr-only">Prioridade {p.label}</span>}
    </span>
  );
}

export const PRIORITY_OPTIONS = Object.entries(PRIORITY).map(([value, v]) => ({ value: value as OrderPriority, label: v.label }));

const SIGNAL: Record<ViewSignal, { label: string; short: string; icon: LucideIcon; cls: string }> = {
  NEVER: { label: 'Nunca visualizada', short: 'Nunca', icon: EyeOff, cls: 'bg-neutral-soft text-muted' },
  CURRENT: { label: 'Versão atual visualizada', short: 'Atual', icon: Eye, cls: 'bg-success-soft text-success' },
  OUTDATED: { label: 'Nova versão pendente de visualização', short: 'Pendente', icon: History, cls: 'bg-warning-soft text-warning' },
  OVERDUE: { label: 'Não visualizada além do SLA', short: 'SLA', icon: AlertTriangle, cls: 'bg-danger-soft text-danger' },
  NO_PORTAL: { label: 'Parte sem acesso ao portal', short: 'Sem portal', icon: Minus, cls: 'bg-transparent text-subtle' },
};

export const SIGNAL_OPTIONS = (['NEVER', 'CURRENT', 'OUTDATED', 'OVERDUE'] as const).map((value) => ({ value, label: SIGNAL[value].label }));

/** Farol de visualização: ícone + texto + tooltip + ARIA (nunca apenas cor). */
export function Farol({
  side,
  info,
  version,
  compact,
  onClick,
}: {
  side: 'Fazenda' | 'Comprador';
  info: ViewSignalInfo;
  version: number;
  compact?: boolean;
  onClick?: () => void;
}) {
  const s = SIGNAL[info.signal];
  const detail =
    info.lastViewedAt && info.viewedVersion != null
      ? `${info.lastViewedBy ?? 'Usuário'} · ${formatDateTime(info.lastViewedAt)} · v${info.viewedVersion}${info.viewedVersion < version ? ` (atual v${version})` : ''}`
      : info.signal === 'NO_PORTAL'
        ? 'Sem organização com usuários no portal'
        : 'Nenhuma visualização registrada';
  const aria = `${side}: ${s.label}. ${detail}`;
  const Comp = onClick ? 'button' : 'span';

  return (
    <Tooltip
      content={
        <span className="block space-y-0.5">
          <span className="block font-medium">
            {side} · {s.label}
          </span>
          <span className="block opacity-80">{detail}</span>
          {onClick ? <span className="block opacity-60">Clique para ver o histórico</span> : null}
        </span>
      }
    >
      <Comp
        type={onClick ? 'button' : undefined}
        onClick={onClick}
        aria-label={aria}
        className={cn(
          'inline-flex items-center gap-1 whitespace-nowrap rounded-full font-medium transition',
          compact ? 'h-6 px-2 text-[11px]' : 'h-7 px-2.5 text-xs',
          s.cls,
          onClick && 'hover:ring-1 hover:ring-current/30',
        )}
      >
        <motion.span key={info.signal} initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="inline-flex">
          <s.icon className={compact ? 'size-3.5' : 'size-4'} aria-hidden />
        </motion.span>
        {compact ? (
          <span>{s.short}</span>
        ) : (
          <span>
            <span className="opacity-70">{side} · </span>
            {s.label}
          </span>
        )}
      </Comp>
    </Tooltip>
  );
}

/** Barra segmentada: recebido ⊂ carregado ⊂ liberado ⊂ total. */
export function QuantityBar({ q, className, showLegend }: { q: OrderQuantities; className?: string; showLegend?: boolean }) {
  const received = ratio(q.received, q.total);
  const loaded = Math.max(0, ratio(q.loaded, q.total) - received);
  const released = Math.max(0, ratio(q.released, q.total) - ratio(q.loaded, q.total));
  const tooltip = (
    <span className="grid grid-cols-[auto_auto] gap-x-4 gap-y-0.5 tabular">
      <span>Total</span>
      <span className="text-right">{formatQty(q.total, q.unit)}</span>
      <span>Liberado</span>
      <span className="text-right">{formatQty(q.released, q.unit)}</span>
      <span>Agendado</span>
      <span className="text-right">{formatQty(q.scheduled, q.unit)}</span>
      <span>Carregado</span>
      <span className="text-right">{formatQty(q.loaded, q.unit)}</span>
      <span>Em trânsito</span>
      <span className="text-right">{formatQty(q.inTransit, q.unit)}</span>
      <span>Recebido</span>
      <span className="text-right">{formatQty(q.received, q.unit)}</span>
      <span className="font-medium">Saldo</span>
      <span className="text-right font-medium">{formatQty(q.balance, q.unit)}</span>
    </span>
  );
  return (
    <div className={cn('min-w-0', className)}>
      <Tooltip content={tooltip}>
        <div
          className="flex h-1.5 w-full overflow-hidden rounded-full bg-surface-3"
          role="img"
          aria-label={`Liberado ${formatQty(q.released, q.unit)}, carregado ${formatQty(q.loaded, q.unit)}, recebido ${formatQty(q.received, q.unit)} de ${formatQty(q.total, q.unit)}`}
        >
          <motion.div className="h-full bg-success" initial={{ width: 0 }} animate={{ width: `${received}%` }} transition={{ duration: 0.6 }} />
          <motion.div className="h-full bg-accent" initial={{ width: 0 }} animate={{ width: `${loaded}%` }} transition={{ duration: 0.6, delay: 0.05 }} />
          <motion.div className="h-full bg-primary/45" initial={{ width: 0 }} animate={{ width: `${released}%` }} transition={{ duration: 0.6, delay: 0.1 }} />
        </div>
      </Tooltip>
      {showLegend ? (
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
          <Legend cls="bg-primary/45" label="Liberado" value={formatQty(q.released, q.unit)} />
          <Legend cls="bg-accent" label="Carregado" value={formatQty(q.loaded, q.unit)} />
          <Legend cls="bg-success" label="Recebido" value={formatQty(q.received, q.unit)} />
        </div>
      ) : null}
    </div>
  );
}

function Legend({ cls, label, value }: { cls: string; label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn('size-2 rounded-sm', cls)} aria-hidden />
      {label} <span className="font-medium text-text tabular">{value}</span>
    </span>
  );
}
