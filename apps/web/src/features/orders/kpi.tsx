'use client';

import { Card, cn } from '@ordens/ui';
import { animate, motion, useMotionValue, useTransform } from 'motion/react';
import { useEffect, type ReactNode } from 'react';
import { ratio } from '@/lib/format';

function AnimatedNumber({ value }: { value: number }) {
  const mv = useMotionValue(0);
  const text = useTransform(mv, (v) => Math.round(v).toLocaleString('pt-BR'));
  useEffect(() => {
    const controls = animate(mv, value, { duration: 0.6, ease: [0.16, 1, 0.3, 1] });
    return () => controls.stop();
  }, [mv, value]);
  return <motion.span>{text}</motion.span>;
}

export function KpiCard({
  label,
  value,
  hint,
  icon,
  progress,
  tone = 'primary',
  active,
  onClick,
}: {
  label: string;
  value: number | string;
  hint?: ReactNode;
  icon?: ReactNode;
  progress?: { value: string; total: string };
  tone?: 'primary' | 'danger' | 'warning' | 'success';
  active?: boolean;
  onClick?: () => void;
}) {
  const toneCls = { primary: 'text-primary bg-primary-soft', danger: 'text-danger bg-danger-soft', warning: 'text-warning bg-warning-soft', success: 'text-success bg-success-soft' }[tone];
  const Comp = onClick ? 'button' : 'div';
  return (
    <Card className={cn('relative overflow-hidden text-left transition', onClick && 'hover:-translate-y-px hover:shadow-md', active && 'ring-2 ring-primary')}>
      <Comp onClick={onClick} className="block h-full w-full p-4 text-left" aria-pressed={onClick ? active : undefined}>
        <div className="flex items-start justify-between gap-3">
          <span className="text-[12.5px] font-medium text-muted">{label}</span>
          {icon ? <span className={cn('grid size-7 place-items-center rounded-md [&_svg]:size-4', toneCls)}>{icon}</span> : null}
        </div>
        <div className="mt-2 text-[26px] font-semibold leading-none tracking-tight tabular">
          {typeof value === 'number' ? <AnimatedNumber value={value} /> : value}
        </div>
        {hint ? <div className="mt-1.5 truncate text-xs text-subtle">{hint}</div> : null}
        {progress ? (
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-3">
            <motion.div
              className="h-full rounded-full bg-primary"
              initial={{ width: 0 }}
              animate={{ width: `${ratio(progress.value, progress.total)}%` }}
              transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
            />
          </div>
        ) : null}
      </Comp>
    </Card>
  );
}
