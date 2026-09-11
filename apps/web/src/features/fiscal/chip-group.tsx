'use client';

import { cn } from '@ordens/ui';

/** Escolha única em chips (role radiogroup). Melhor que select para poucas opções com rótulos curtos. */
export function ChipGroup<T extends string>({
  value,
  onChange,
  options,
  label,
  disabled,
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string; hint?: string }[];
  label: string;
  disabled?: boolean;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            title={o.hint}
            onClick={() => onChange(o.value)}
            className={cn(
              'h-8 rounded-full px-3 text-[13px] font-medium ring-1 transition disabled:cursor-not-allowed disabled:opacity-60',
              active ? 'bg-primary-soft text-primary ring-primary/40' : 'bg-surface text-muted ring-border hover:text-text hover:ring-border-strong',
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
