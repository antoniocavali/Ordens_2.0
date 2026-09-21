'use client';

import { cn } from '@ordens/ui';
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import { motion } from 'motion/react';

const ease = [0.16, 1, 0.3, 1] as const;

/** Duração legível a partir de minutos: 45 min · 3 h 20 min · 2 d 4 h. */
export function formatDuration(minutes: number | null): string {
  if (minutes === null) return '—';
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 1440) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m ? `${h} h ${m} min` : `${h} h`;
  }
  const d = Math.floor(minutes / 1440);
  const h = Math.floor((minutes % 1440) / 60);
  return h ? `${d} d ${h} h` : `${d} d`;
}

/**
 * Variação contra o período anterior. `lowerIsBetter` inverte a cor (ex.: tempo de resposta).
 * Sem base anterior não há percentual.
 */
export function Delta({ current, previous, lowerIsBetter = false }: { current: number | null; previous: number | null; lowerIsBetter?: boolean }) {
  if (current === null || previous === null || previous === 0) return <span className="text-xs text-subtle">sem base anterior</span>;
  const pct = Math.round(((current - previous) / previous) * 100);
  if (pct === 0) {
    return (
      <span className="inline-flex items-center gap-0.5 text-xs text-muted">
        <Minus className="size-3" /> igual ao período anterior
      </span>
    );
  }
  const up = pct > 0;
  const good = lowerIsBetter ? !up : up;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={cn('inline-flex items-center gap-0.5 text-xs font-medium', good ? 'text-success' : 'text-danger')} title="Comparado ao período anterior de mesmo tamanho">
      <Icon className="size-3.5" />
      {up ? '+' : ''}
      {pct}% vs. anterior
    </span>
  );
}

const dayLabel = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}`;

/** Barras diárias agrupadas (abertas × resolvidas), com tabela equivalente para leitores de tela. */
export function DailyVolumeChart({ points }: { points: { day: string; opened: number; resolved: number }[] }) {
  const W = 720;
  const H = 220;
  const left = 30;
  const bottom = 22;
  const top = 10;
  const max = Math.max(...points.flatMap((p) => [p.opened, p.resolved]), 1);
  const nice = max <= 5 ? 5 : Math.ceil(max / 5) * 5;
  const band = (W - left) / Math.max(points.length, 1);
  const every = Math.ceil(points.length / 10);
  const y = (v: number) => top + (H - top - bottom) * (1 - v / nice);

  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-56 w-full" role="img" aria-label="Conversas abertas e resolvidas por dia">
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={left} x2={W} y1={y(nice * f)} y2={y(nice * f)} className="stroke-border" strokeDasharray="3 4" />
            <text x={left - 6} y={y(nice * f) + 3} textAnchor="end" className="fill-subtle text-[10px]">
              {Math.round(nice * f)}
            </text>
          </g>
        ))}
        {points.map((p, i) => {
          const x = left + i * band;
          const w = Math.max(band * 0.34, 1.5);
          return (
            <g key={p.day}>
              <motion.rect
                x={x + band * 0.14}
                width={w}
                rx={Math.min(2, w / 2)}
                className="fill-primary"
                initial={{ y: H - bottom, height: 0 }}
                animate={{ y: y(p.opened), height: H - bottom - y(p.opened) }}
                transition={{ duration: 0.6, delay: Math.min(i * 0.012, 0.4), ease }}
              >
                <title>{`${dayLabel(p.day)} · ${p.opened} abertas`}</title>
              </motion.rect>
              <motion.rect
                x={x + band * 0.52}
                width={w}
                rx={Math.min(2, w / 2)}
                className="fill-success/70"
                initial={{ y: H - bottom, height: 0 }}
                animate={{ y: y(p.resolved), height: H - bottom - y(p.resolved) }}
                transition={{ duration: 0.6, delay: Math.min(i * 0.012, 0.4), ease }}
              >
                <title>{`${dayLabel(p.day)} · ${p.resolved} resolvidas`}</title>
              </motion.rect>
              {i % every === 0 ? (
                <text x={x + band / 2} y={H - 6} textAnchor="middle" className="fill-subtle text-[10px]">
                  {dayLabel(p.day)}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
      <figcaption className="mt-1 flex gap-4 text-xs text-muted">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-primary" /> Abertas
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-success/70" /> Resolvidas
        </span>
      </figcaption>
      {/* sr-only no wrapper: no <table> a <caption> escapa do recorte (Firefox) e estica a página. */}
      <div className="sr-only">
        <table>
          <caption>Conversas por dia</caption>
          <thead>
            <tr>
              <th>Dia</th>
              <th>Abertas</th>
              <th>Resolvidas</th>
            </tr>
          </thead>
          <tbody>
            {points.map((p) => (
              <tr key={p.day}>
                <td>{dayLabel(p.day)}</td>
                <td>{p.opened}</td>
                <td>{p.resolved}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}

/** Barras horizontais com contagem e participação no total. */
export function BarList({ rows, empty, ariaLabel }: { rows: { key: string; label: string; count: number; className?: string }[]; empty: string; ariaLabel: string }) {
  const total = rows.reduce((a, r) => a + r.count, 0);
  if (!total) return <p className="py-6 text-center text-sm text-subtle">{empty}</p>;
  const max = Math.max(...rows.map((r) => r.count), 1);
  return (
    <ul className="space-y-2.5" aria-label={ariaLabel}>
      {rows.map((r, i) => (
        <li key={r.key} className="grid grid-cols-[minmax(96px,140px)_1fr_auto] items-center gap-3 text-sm">
          <span className="truncate text-muted">{r.label}</span>
          <div className="h-2.5 overflow-hidden rounded-full bg-surface-3">
            <motion.div
              className={cn('h-full rounded-full', r.className ?? 'bg-primary')}
              initial={{ width: 0 }}
              animate={{ width: `${(r.count / max) * 100}%` }}
              transition={{ duration: 0.6, delay: i * 0.04, ease }}
            />
          </div>
          <span className="w-20 text-right tabular">
            <span className="font-semibold">{r.count}</span>
            <span className="ml-1.5 text-xs text-subtle">{Math.round((r.count / total) * 100)}%</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Volume por hora do dia (0–23h): intensidade proporcional ao pico. */
export function HourStrip({ hours }: { hours: { hour: number; count: number }[] }) {
  const max = Math.max(...hours.map((h) => h.count), 1);
  const peak = hours.reduce((a, h) => (h.count > a.count ? h : a), hours[0] ?? { hour: 0, count: 0 });
  return (
    <figure>
      <div className="grid grid-cols-12 gap-1 sm:grid-cols-24" role="img" aria-label={`Conversas abertas por hora do dia; pico às ${peak.hour}h`}>
        {hours.map((h) => (
          <div key={h.hour} className="flex flex-col items-center gap-1">
            <div className="flex h-24 w-full items-end overflow-hidden rounded bg-surface-2">
              <motion.div
                className="w-full rounded bg-primary"
                style={{ opacity: h.count ? 0.35 + 0.65 * (h.count / max) : 0 }}
                initial={{ height: 0 }}
                animate={{ height: `${(h.count / max) * 100}%` }}
                transition={{ duration: 0.5, delay: h.hour * 0.015, ease }}
                title={`${h.hour}h · ${h.count}`}
              />
            </div>
            <span className="text-[10px] tabular text-subtle">{h.hour % 3 === 0 ? `${h.hour}h` : ''}</span>
          </div>
        ))}
      </div>
      <figcaption className="mt-2 text-xs text-muted">{peak.count ? `Pico às ${peak.hour}h (${peak.count} conversas)` : 'Sem conversas no período'}</figcaption>
    </figure>
  );
}
