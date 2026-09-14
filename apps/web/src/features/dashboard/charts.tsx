'use client';

import { cn } from '@ordens/ui';
import { motion } from 'motion/react';
import { formatQtyCompact } from '@/lib/format';

const ease = [0.16, 1, 0.3, 1] as const;
// Proporções visuais apenas; os valores exibidos vêm como string decimal da API.
const num = (v: string) => Number(v) || 0;

/**
 * Funil de volume. Percentuais sempre sobre "Em ordens" (e "Em ordens" sobre "Contratado"):
 * comparar com a etapa anterior distorce, pois agendado é só o que ainda não carregou.
 */
export function FunnelChart({ steps }: { steps: { key: string; label: string; valueT: string }[] }) {
  const max = Math.max(...steps.map((s) => num(s.valueT)), 1);
  const ordered = num(steps.find((s) => s.key === 'ordered')?.valueT ?? '0');
  const contracted = num(steps.find((s) => s.key === 'contracted')?.valueT ?? '0');
  return (
    <ol className="space-y-2.5" aria-label="Funil de volume em toneladas">
      {steps.map((s, i) => {
        const value = num(s.valueT);
        const prev = s.key === 'contracted' ? 0 : s.key === 'ordered' ? contracted : ordered;
        return (
          <li key={s.key} className="grid grid-cols-[88px_1fr_auto] items-center gap-3 text-sm">
            <span className="truncate text-muted">{s.label}</span>
            <div className="h-7 overflow-hidden rounded-md bg-surface-2">
              <motion.div
                className="h-full rounded-md bg-primary"
                style={{ opacity: Math.max(0.35, 1 - i * 0.12) }}
                initial={{ width: 0 }}
                animate={{ width: `${(value / max) * 100}%` }}
                transition={{ duration: 0.7, delay: i * 0.05, ease }}
              />
            </div>
            <span className="w-32 text-right tabular">
              <span className="font-semibold">{formatQtyCompact(s.valueT, 't')}</span>
              {prev > 0 ? (
                <span className="ml-1.5 text-xs text-subtle" title={s.key === 'ordered' ? 'do contratado' : 'do volume em ordens'}>
                  {Math.round((value / prev) * 100)}%
                </span>
              ) : null}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

const dayLabel = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}`;

/** Barras diárias: carregado × recebido (toneladas). Tabela equivalente para leitores de tela. */
export function DailyChart({ points }: { points: { day: string; loadedT: string; receivedT: string }[] }) {
  const W = 640;
  const H = 200;
  const left = 36;
  const bottom = 22;
  const top = 10;
  const max = Math.max(...points.flatMap((p) => [num(p.loadedT), num(p.receivedT)]), 1);
  const band = (W - left) / Math.max(points.length, 1);
  const every = Math.ceil(points.length / 8);
  const y = (v: number) => top + (H - top - bottom) * (1 - v / max);

  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-52 w-full" role="img" aria-label="Toneladas carregadas e recebidas por dia">
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={left} x2={W} y1={y(max * f)} y2={y(max * f)} className="stroke-border" strokeDasharray="3 4" />
            <text x={left - 6} y={y(max * f) + 3} textAnchor="end" className="fill-subtle text-[10px]">
              {formatQtyCompact(String(max * f), '')}
            </text>
          </g>
        ))}
        {points.map((p, i) => {
          const x = left + i * band;
          const loaded = num(p.loadedT);
          const received = num(p.receivedT);
          return (
            <g key={p.day}>
              <motion.rect
                x={x + band * 0.14}
                width={band * 0.34}
                rx={2}
                className="fill-primary"
                initial={{ y: H - bottom, height: 0 }}
                animate={{ y: y(loaded), height: H - bottom - y(loaded) }}
                transition={{ duration: 0.6, delay: i * 0.015, ease }}
              >
                <title>{`${dayLabel(p.day)} · carregado ${formatQtyCompact(p.loadedT, 't')}`}</title>
              </motion.rect>
              <motion.rect
                x={x + band * 0.52}
                width={band * 0.34}
                rx={2}
                className="fill-success/70"
                initial={{ y: H - bottom, height: 0 }}
                animate={{ y: y(received), height: H - bottom - y(received) }}
                transition={{ duration: 0.6, delay: i * 0.015, ease }}
              >
                <title>{`${dayLabel(p.day)} · recebido ${formatQtyCompact(p.receivedT, 't')}`}</title>
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
          <span className="size-2.5 rounded-sm bg-primary" /> Carregado
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-success/70" /> Recebido
        </span>
      </figcaption>
      <table className="sr-only">
        <caption>Toneladas por dia</caption>
        <thead>
          <tr>
            <th>Dia</th>
            <th>Carregado</th>
            <th>Recebido</th>
          </tr>
        </thead>
        <tbody>
          {points.map((p) => (
            <tr key={p.day}>
              <td>{dayLabel(p.day)}</td>
              <td>{p.loadedT}</td>
              <td>{p.receivedT}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

/** Lista com barra de progresso (carregado sobre total). */
export function ProgressList({ rows, empty }: { rows: { id: string; label: string; sublabel?: string | null; value: string; total: string; href?: string }[]; empty: string }) {
  if (!rows.length) return <p className="py-6 text-center text-sm text-subtle">{empty}</p>;
  return (
    <ul className="space-y-3">
      {rows.map((r, i) => {
        const total = num(r.total);
        const pct = total > 0 ? Math.min(100, (num(r.value) / total) * 100) : 0;
        const content = (
          <>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="min-w-0 truncate">
                <span className="font-medium">{r.label}</span>
                {r.sublabel ? <span className="text-muted"> · {r.sublabel}</span> : null}
              </span>
              <span className="shrink-0 text-xs tabular text-muted">
                {formatQtyCompact(r.value, 't')} / {formatQtyCompact(r.total, 't')}
              </span>
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-3">
              <motion.div className={cn('h-full rounded-full', pct >= 100 ? 'bg-success' : 'bg-primary')} initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 0.6, delay: i * 0.04, ease }} />
            </div>
          </>
        );
        return <li key={r.id}>{r.href ? <a href={r.href} className="block rounded-md transition hover:opacity-80">{content}</a> : content}</li>;
      })}
    </ul>
  );
}
