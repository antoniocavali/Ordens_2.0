'use client';

import type { RoleDto } from '@ordens/contracts';
import { cn } from '@ordens/ui';
import { roleHint } from './roles';

/** Seleção de papéis (do sistema e personalizados) compatíveis com o tipo da organização. */
export function RolePicker({
  kind,
  roles,
  value,
  onChange,
  disabled,
  error,
}: {
  kind: string;
  roles: readonly RoleDto[];
  value: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
  error?: string;
}) {
  // Papel arquivado continua visível só para quem já o tem (permite remover).
  const options = roles.filter((r) => r.scope === kind && (r.status === 'ACTIVE' || value.includes(r.id)));
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
        const checked = value.includes(o.id);
        return (
          <label
            key={o.id}
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
              disabled={o.status !== 'ACTIVE' && !checked}
              onChange={(e) => onChange(e.target.checked ? [...value, o.id] : value.filter((r) => r !== o.id))}
            />
            <span className="min-w-0">
              <span className="flex items-center gap-1.5 text-sm font-medium">
                {o.name}
                {!o.system ? <span className="rounded bg-primary-soft px-1.5 text-[10.5px] font-medium text-primary">Personalizado</span> : null}
                {o.status !== 'ACTIVE' ? <span className="rounded bg-neutral-soft px-1.5 text-[10.5px] font-medium text-muted">Arquivado</span> : null}
              </span>
              <span className="block text-xs text-muted">{roleHint(o)}</span>
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
