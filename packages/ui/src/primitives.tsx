import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { cva, type VariantProps } from 'class-variance-authority';
import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from './cn';

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-lg bg-surface shadow-sm ring-1 ring-border/60', className)} {...props} />;
}

export const badgeVariants = cva('inline-flex items-center gap-1 whitespace-nowrap rounded-full font-medium [&_svg]:size-3.5', {
  variants: {
    tone: {
      neutral: 'bg-neutral-soft text-muted',
      primary: 'bg-primary-soft text-primary',
      success: 'bg-success-soft text-success',
      warning: 'bg-warning-soft text-warning',
      danger: 'bg-danger-soft text-danger',
      info: 'bg-info-soft text-info',
    },
    size: { sm: 'h-5 px-2 text-[11px]', md: 'h-6 px-2.5 text-xs' },
  },
  defaultVariants: { tone: 'neutral', size: 'md' },
});

export function Badge({ className, tone, size, ...props }: HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone, size }), className)} {...props} />;
}

export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('animate-pulse rounded-md bg-surface-3/80', className)} aria-hidden {...props} />;
}

export function Kbd({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return (
    <kbd
      className={cn('inline-flex h-5 min-w-5 items-center justify-center rounded border border-border-strong bg-surface px-1 font-mono text-[10.5px] text-muted', className)}
      {...props}
    />
  );
}

export const TooltipProvider = TooltipPrimitive.Provider;

export function Tooltip({ content, children, side = 'top', delay = 250 }: { content: ReactNode; children: ReactNode; side?: 'top' | 'bottom' | 'left' | 'right'; delay?: number }) {
  if (!content) return <>{children}</>;
  return (
    <TooltipPrimitive.Root delayDuration={delay}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          sideOffset={6}
          className="z-[80] max-w-72 rounded-md bg-text px-2.5 py-1.5 text-xs leading-snug text-bg shadow-lg data-[state=delayed-open]:animate-in data-[state=delayed-open]:fade-in"
        >
          {content}
          <TooltipPrimitive.Arrow className="fill-text" />
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}

export function EmptyState({ icon, title, description, action, className }: { icon?: ReactNode; title: string; description?: string; action?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-3 px-6 py-14 text-center', className)}>
      {icon ? <div className="grid size-12 place-items-center rounded-full bg-primary-soft text-primary [&_svg]:size-6">{icon}</div> : null}
      <div className="space-y-1">
        <p className="text-[15px] font-semibold">{title}</p>
        {description ? <p className="max-w-sm text-sm text-muted">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}
