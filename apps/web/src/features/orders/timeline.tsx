'use client';

import type { TimelineEventDto } from '@ordens/contracts';
import { cn, Skeleton } from '@ordens/ui';
import { Eye, FilePen, GitCommitVertical, PackageCheck, PackageX, PlusCircle, Send } from 'lucide-react';
import { motion } from 'motion/react';
import { formatDateTime, formatQty, formatRelative } from '@/lib/format';

const ICONS: Record<string, { icon: typeof Send; cls: string }> = {
  'order.created': { icon: PlusCircle, cls: 'bg-neutral-soft text-muted' },
  'order.draft_saved': { icon: FilePen, cls: 'bg-neutral-soft text-muted' },
  'order.published': { icon: Send, cls: 'bg-primary-soft text-primary' },
  'order.version_created': { icon: GitCommitVertical, cls: 'bg-warning-soft text-warning' },
  'order.updated': { icon: FilePen, cls: 'bg-neutral-soft text-muted' },
  'order.release_created': { icon: PackageCheck, cls: 'bg-info-soft text-info' },
  'order.release_cancelled': { icon: PackageX, cls: 'bg-danger-soft text-danger' },
  'order.viewed': { icon: Eye, cls: 'bg-success-soft text-success' },
};

export function Timeline({ events, loading, limit, unit }: { events?: TimelineEventDto[]; loading?: boolean; limit?: number; unit?: string }) {
  if (loading) return <div className="space-y-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10" />)}</div>;
  if (!events?.length) return <p className="text-sm text-muted">Nenhum evento registrado.</p>;
  // Rascunhos salvos em sequência são agrupados para não poluir a linha do tempo.
  const compact = events.filter((e, i) => !(e.action === 'order.draft_saved' && events[i + 1]?.action === 'order.draft_saved'));
  const list = [...compact].reverse().slice(0, limit);

  return (
    <ol className="relative space-y-4">
      <span className="absolute bottom-2 left-[13px] top-2 w-px bg-border" aria-hidden />
      {list.map((e, i) => {
        const cfg = ICONS[e.action] ?? { icon: GitCommitVertical, cls: 'bg-neutral-soft text-muted' };
        const ctx = e.context as Record<string, unknown> | null;
        return (
          <motion.li key={e.id} initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.03 }} className="relative flex gap-3">
            <span className={cn('relative z-10 grid size-7 shrink-0 place-items-center rounded-full ring-4 ring-surface', cfg.cls)}>
              <cfg.icon className="size-3.5" />
            </span>
            <div className="min-w-0 pt-0.5">
              <div className="text-[13px] font-medium">{e.label}</div>
              <div className="text-xs text-muted">
                {[e.actor, e.organization].filter(Boolean).join(' · ') || 'Sistema'}
                {ctx?.quantity ? ` · ${formatQty(String(ctx.quantity), unit)}` : ''}
                {e.action === 'order.version_created' && ctx?.version ? ` · v${String(ctx.version)}` : ''}
              </div>
              <time dateTime={e.at} title={formatDateTime(e.at)} className="text-[11px] text-subtle">
                {formatRelative(e.at)}
              </time>
            </div>
          </motion.li>
        );
      })}
    </ol>
  );
}
