'use client';

import type { AppointmentDto } from '@ordens/contracts';
import { Button, Card, cn, EmptyState, Skeleton } from '@ordens/ui';
import { CalendarClock, CalendarDays, ChevronLeft, ChevronRight, List, Plus, Rows3, Truck } from 'lucide-react';
import { motion } from 'motion/react';
import { useMemo, useState } from 'react';
import { formatDate, formatQty } from '@/lib/format';
import { useCan } from '@/lib/session';
import { AppointmentDrawer } from './appointment-drawer';
import { Plates } from './fleet-fields';
import { AppointmentStatusBadge } from './load-status';
import { useAppointments } from './logistics-api';

type View = 'week' | 'day' | 'list';
const DAY_MS = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const utc = (s: string) => new Date(`${s}T00:00:00Z`);

function weekStart(dateIso: string) {
  const d = utc(dateIso);
  const dow = (d.getUTCDay() + 6) % 7; // segunda = 0
  return iso(new Date(d.getTime() - dow * DAY_MS));
}

const weekday = new Intl.DateTimeFormat('pt-BR', { weekday: 'short', timeZone: 'UTC' });
const dayMonth = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', timeZone: 'UTC' });

function AppointmentCard({ a, onOpen, compact }: { a: AppointmentDto; onOpen: () => void; compact?: boolean }) {
  const noCarrier = !a.carrier && ['REQUESTED', 'CONFIRMED'].includes(a.status);
  return (
    <motion.button
      layout
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      onClick={onOpen}
      className={cn(
        'w-full space-y-1.5 rounded-lg bg-surface p-2.5 text-left shadow-xs ring-1 ring-border/80 transition hover:-translate-y-px hover:shadow-md hover:ring-primary/40',
        (a.status === 'CANCELLED' || a.status === 'NO_SHOW') && 'opacity-55',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-xs font-semibold">{a.order.number}</span>
        <span className="text-[11px] tabular text-muted">{a.windowStart ? `${a.windowStart}–${a.windowEnd ?? ''}` : 'dia todo'}</span>
      </div>
      <div className="truncate text-xs text-muted">
        {a.order.commodity} · {a.order.farm}
      </div>
      {!compact ? <Plates plates={a.plates} /> : null}
      <div className="flex items-center justify-between gap-2">
        <AppointmentStatusBadge status={a.status} />
        <span className="text-[11px] font-medium tabular">{formatQty(a.expectedQty, a.order.unit)}</span>
      </div>
      {noCarrier ? <div className="text-[11px] font-medium text-warning">Sem transportadora</div> : null}
    </motion.button>
  );
}

export function AppointmentsPage() {
  const can = useCan();
  const [view, setView] = useState<View>('week');
  const [anchor, setAnchor] = useState(iso(new Date()));
  const [open, setOpen] = useState<AppointmentDto | 'new' | null>(null);
  const [newDate, setNewDate] = useState<string | undefined>();

  const range = useMemo(() => {
    if (view === 'day') return { from: anchor, to: anchor };
    if (view === 'week') {
      const start = weekStart(anchor);
      return { from: start, to: iso(new Date(utc(start).getTime() + 6 * DAY_MS)) };
    }
    return { from: iso(new Date(utc(anchor).getTime() - 7 * DAY_MS)), to: iso(new Date(utc(anchor).getTime() + 30 * DAY_MS)) };
  }, [view, anchor]);

  const list = useAppointments({ from: range.from, to: range.to, pageSize: 200 });
  const items = list.data?.items ?? [];
  const days = view === 'week' ? Array.from({ length: 7 }, (_, i) => iso(new Date(utc(range.from).getTime() + i * DAY_MS))) : [anchor];
  const step = view === 'day' ? 1 : 7;
  const shift = (dir: number) => setAnchor(iso(new Date(utc(anchor).getTime() + dir * step * DAY_MS)));

  const active = items.filter((a) => ['REQUESTED', 'CONFIRMED', 'CHECKED_IN'].includes(a.status));
  const withoutCarrier = active.filter((a) => !a.carrier).length;

  const openNew = (date?: string) => {
    setNewDate(date);
    setOpen('new');
  };

  return (
    <div className="mx-auto flex max-w-[1800px] flex-col gap-5 px-4 py-6 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <span className="grid size-11 place-items-center rounded-xl bg-primary-soft text-primary">
            <CalendarClock className="size-5" />
          </span>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Agendamentos</h1>
            <p className="text-sm text-muted">Janelas de carregamento nas fazendas, com transportadora, motorista e veículo.</p>
          </div>
        </div>
        {can('appointment.manage') ? (
          <Button onClick={() => openNew()}>
            <Plus /> Novo agendamento
          </Button>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center rounded-lg bg-surface p-1 ring-1 ring-border" role="tablist" aria-label="Visualização">
          {(
            [
              ['week', 'Semana', CalendarDays],
              ['day', 'Dia', Rows3],
              ['list', 'Lista', List],
            ] as const
          ).map(([v, label, Icon]) => (
            <button
              key={v}
              role="tab"
              aria-selected={view === v}
              onClick={() => setView(v)}
              className={cn('relative flex h-8 items-center gap-1.5 rounded-md px-3 text-[13px] font-medium', view === v ? 'text-primary' : 'text-muted hover:text-text')}
            >
              {view === v ? <motion.span layoutId="appt-view" className="absolute inset-0 rounded-md bg-primary-soft" /> : null}
              <Icon className="relative size-4" />
              <span className="relative">{label}</span>
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon-sm" aria-label="Anterior" onClick={() => shift(-1)}>
            <ChevronLeft />
          </Button>
          <Button variant="outline" size="sm" onClick={() => setAnchor(iso(new Date()))}>
            Hoje
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label="Próximo" onClick={() => shift(1)}>
            <ChevronRight />
          </Button>
          <span className="ml-2 text-sm font-medium">{view === 'day' ? formatDate(anchor) : `${formatDate(range.from)} – ${formatDate(range.to)}`}</span>
        </div>
        <div className="ml-auto flex gap-2 text-xs">
          <span className="rounded-full bg-surface px-3 py-1.5 ring-1 ring-border">
            <strong className="tabular">{active.length}</strong> ativos
          </span>
          {withoutCarrier ? (
            <span className="rounded-full bg-warning-soft px-3 py-1.5 font-medium text-warning">
              <strong className="tabular">{withoutCarrier}</strong> sem transportadora
            </span>
          ) : null}
        </div>
      </div>

      {list.isLoading ? (
        <Skeleton className="h-120 rounded-lg" />
      ) : view === 'list' ? (
        <Card className="overflow-hidden">
          {items.length === 0 ? (
            <EmptyState icon={<CalendarClock />} title="Nenhum agendamento no período" />
          ) : (
            <ul className="divide-y divide-border/70">
              {items.map((a) => (
                <li key={a.id}>
                  <button onClick={() => setOpen(a)} className="grid w-full grid-cols-1 items-center gap-2 px-4 py-3 text-left hover:bg-primary-soft/30 sm:grid-cols-[120px_130px_1fr_220px_120px_150px]">
                    <span className="text-sm font-medium">{formatDate(a.scheduledOn)}</span>
                    <span className="font-mono text-sm">{a.order.number}</span>
                    <span className="truncate text-sm text-muted">
                      {a.order.farm} · {a.driver?.name ?? 'motorista a definir'}
                    </span>
                    <Plates plates={a.plates} />
                    <span className="text-right text-sm tabular">{formatQty(a.expectedQty, a.order.unit)}</span>
                    <span className="sm:text-right">
                      <AppointmentStatusBadge status={a.status} />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : (
        <div className={cn('grid gap-3', view === 'week' ? 'grid-cols-1 md:grid-cols-7' : 'grid-cols-1')}>
          {days.map((d) => {
            const dayItems = items.filter((a) => a.scheduledOn === d);
            const today = d === iso(new Date());
            return (
              <Card key={d} className={cn('flex flex-col overflow-hidden md:min-h-105', today && 'ring-2 ring-primary/50')}>
                <div className="flex items-center justify-between border-b border-border/70 px-3 py-2">
                  <div>
                    <div className={cn('text-[11px] font-semibold uppercase tracking-wider', today ? 'text-primary' : 'text-subtle')}>{weekday.format(utc(d)).replace('.', '')}</div>
                    <div className="text-sm font-semibold">{dayMonth.format(utc(d)).replace('.', '')}</div>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-xs tabular text-muted">{dayItems.length}</span>
                    {can('appointment.manage') ? (
                      <Button variant="ghost" size="icon-sm" aria-label={`Agendar em ${formatDate(d)}`} onClick={() => openNew(d)}>
                        <Plus />
                      </Button>
                    ) : null}
                  </div>
                </div>
                <div className="flex-1 space-y-2 overflow-y-auto bg-surface-2/40 p-2">
                  {dayItems.length === 0 ? (
                    <div className="flex h-full flex-row items-center justify-center gap-1.5 py-2 text-xs text-subtle md:flex-col md:py-10">
                      <Truck className="size-4" />
                      Livre
                    </div>
                  ) : (
                    dayItems.map((a) => <AppointmentCard key={a.id} a={a} compact={view === 'week'} onOpen={() => setOpen(a)} />)
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <AppointmentDrawer appointment={open === 'new' ? null : open} open={open !== null} defaultDate={newDate} onClose={() => setOpen(null)} />
    </div>
  );
}
