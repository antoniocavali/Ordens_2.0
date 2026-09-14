'use client';

import { APPOINTMENT_STATUS_LABELS, LOAD_STAGES, LOAD_STATUS_LABELS, type AppointmentStatus, type LoadStatus } from '@ordens/contracts';
import { Badge, cn } from '@ordens/ui';
import { Ban, CalendarCheck, CheckCircle2, CircleDot, Clock, PackageCheck, Receipt, Truck, Warehouse, type LucideIcon } from 'lucide-react';

type Tone = 'neutral' | 'primary' | 'info' | 'warning' | 'success' | 'danger';

const STAGE_TONE: Record<string, { tone: Tone; icon: LucideIcon }> = {
  scheduling: { tone: 'neutral', icon: CalendarCheck },
  loading: { tone: 'warning', icon: Warehouse },
  transit: { tone: 'info', icon: Truck },
  receiving: { tone: 'primary', icon: PackageCheck },
  billing: { tone: 'success', icon: Receipt },
};

export function stageOf(status: LoadStatus) {
  return LOAD_STAGES.find((s) => (s.statuses as readonly string[]).includes(status));
}

export function LoadStatusBadge({ status, size = 'sm' }: { status: LoadStatus; size?: 'sm' | 'md' }) {
  if (status === 'CANCELLED') {
    return (
      <Badge tone="danger" size={size}>
        <Ban /> {LOAD_STATUS_LABELS[status]}
      </Badge>
    );
  }
  if (status === 'COMPLETED') {
    return (
      <Badge tone="success" size={size}>
        <CheckCircle2 /> {LOAD_STATUS_LABELS[status]}
      </Badge>
    );
  }
  const stage = stageOf(status);
  const cfg = stage ? STAGE_TONE[stage.key]! : { tone: 'neutral' as Tone, icon: CircleDot };
  return (
    <Badge tone={cfg.tone} size={size}>
      <cfg.icon /> {LOAD_STATUS_LABELS[status]}
    </Badge>
  );
}

const APPT_TONE: Record<AppointmentStatus, Tone> = {
  REQUESTED: 'neutral',
  CONFIRMED: 'primary',
  CHECKED_IN: 'info',
  CONVERTED: 'success',
  CANCELLED: 'danger',
  NO_SHOW: 'warning',
};

export function AppointmentStatusBadge({ status }: { status: AppointmentStatus }) {
  return (
    <Badge tone={APPT_TONE[status]} size="sm">
      {status === 'REQUESTED' ? <Clock /> : status === 'CONVERTED' ? <Truck /> : status === 'CANCELLED' ? <Ban /> : <CalendarCheck />}
      {APPOINTMENT_STATUS_LABELS[status]}
    </Badge>
  );
}

/** Etapas macro da carga com a atual destacada (ícone + texto, nunca só cor). */
export function LoadStepper({ status }: { status: LoadStatus }) {
  // Concluída: todas as etapas feitas (COMPLETED também pertence ao estágio de faturamento).
  const current = status === 'COMPLETED' ? undefined : stageOf(status);
  const currentIndex = status === 'COMPLETED' ? LOAD_STAGES.length : current ? LOAD_STAGES.indexOf(current) : -1;
  return (
    <ol className="flex w-full items-center gap-1" aria-label={`Etapa atual: ${LOAD_STATUS_LABELS[status]}`}>
      {LOAD_STAGES.map((s, i) => {
        const done = status !== 'CANCELLED' && i < currentIndex;
        const active = i === currentIndex && status !== 'CANCELLED';
        const Icon = STAGE_TONE[s.key]!.icon;
        return (
          <li key={s.key} className="flex min-w-0 flex-1 items-center gap-1">
            <div className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
              <span
                className={cn(
                  'grid size-8 place-items-center rounded-full ring-1 transition',
                  done && 'bg-success text-white ring-success',
                  active && 'bg-primary text-primary-fg ring-primary shadow-sm shadow-primary/30',
                  !done && !active && 'bg-surface-2 text-subtle ring-border',
                )}
                aria-current={active ? 'step' : undefined}
              >
                {done ? <CheckCircle2 className="size-4" /> : <Icon className="size-4" />}
              </span>
              <span className={cn('truncate text-[11px] font-medium', active ? 'text-primary' : done ? 'text-text' : 'text-subtle')}>{s.label}</span>
            </div>
            {i < LOAD_STAGES.length - 1 ? <span className={cn('mb-5 h-0.5 w-4 shrink-0 rounded-full sm:w-6', done ? 'bg-success' : 'bg-border')} aria-hidden /> : null}
          </li>
        );
      })}
    </ol>
  );
}
