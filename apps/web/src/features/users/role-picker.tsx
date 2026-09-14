'use client';

import { cn } from '@ordens/ui';
import { rolesForKind } from './roles';

/** Seleção de papéis compatíveis com o tipo da organização. */
export function RolePicker({ kind, value, onChange, disabled, error }: { kind: string; value: string[]; onChange: (roles: string[]) => void; disabled?: boolean; error?: string }) {
  const options = rolesForKind(kind);
  if (!options.length) {
    return (
      <div className="space-y-1">
        <p className="text-sm text-subtle">Selecione a organização para ver os papéis disponíveis.</p>
        {error ? (
          <p role="alert" className="text-xs text-danger">
            {error}
          </p>
        ) : null}
      </div>
    );
  }
  return (
    <fieldset className="space-y-2" disabled={disabled}>
      <legend className="sr-only">Papéis</legend>
      {options.map((o) => {
        const checked = value.includes(o.code);
        return (
          <label
            key={o.code}
            className={cn(
              'flex cursor-pointer items-start gap-3 rounded-lg px-3 py-2.5 ring-1 transition',
              checked ? 'bg-primary-soft/50 ring-primary/40' : 'ring-border hover:bg-surface-2',
              disabled && 'cursor-not-allowed opacity-60',
            )}
          >
            <input
              type="checkbox"
              className="mt-0.5 size-4 accent-[var(--color-primary)]"
              checked={checked}
              onChange={(e) => onChange(e.target.checked ? [...value, o.code] : value.filter((r) => r !== o.code))}
            />
            <span className="min-w-0">
              <span className="block text-sm font-medium">{o.name}</span>
              {o.hint ? <span className="block text-xs text-muted">{o.hint}</span> : null}
            </span>
          </label>
        );
      })}
      {error ? (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}
