'use client';

import { cn } from '@ordens/ui';
import { useQueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';
import { toast } from 'sonner';
import { ApiRequestError } from '@/lib/api';

/** Aplica erros de validação do servidor nos campos e mostra toast com a mensagem geral. */
export function handleSaveError<T extends FieldValues>(err: unknown, setError: UseFormSetError<T>, fallback = 'Não foi possível salvar.') {
  if (err instanceof ApiRequestError) {
    for (const [field, messages] of Object.entries(err.fieldErrors)) {
      setError(field as Path<T>, { type: 'server', message: messages[0] });
    }
    toast.error(err.message);
    return;
  }
  toast.error(fallback);
}

export function useInvalidateRegistry() {
  const qc = useQueryClient();
  return (key: string) => {
    void qc.invalidateQueries({ queryKey: ['registry', key] });
    void qc.invalidateQueries({ queryKey: ['lookup'] });
  };
}

export function FormSection({ title, description, children, className }: { title: string; description?: string; children: ReactNode; className?: string }) {
  return (
    <section className={cn('border-b border-border/60 px-5 py-6 last:border-0 sm:px-7', className)}>
      <div className="mb-4">
        <h3 className="text-[11.5px] font-semibold uppercase tracking-[0.08em] text-primary">{title}</h3>
        {description ? <p className="mt-0.5 text-xs text-subtle">{description}</p> : null}
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-6">{children}</div>
    </section>
  );
}

export const span = { 1: 'sm:col-span-1', 2: 'sm:col-span-2', 3: 'sm:col-span-3', 4: 'sm:col-span-4', 6: 'sm:col-span-6' } as const;

export function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0 rounded-lg bg-surface-2/70 px-3 py-2.5">
      <div className="text-[11px] text-subtle">{label}</div>
      <div className="truncate text-sm font-semibold tabular">{value}</div>
    </div>
  );
}

export const formatPhone = (v: string | null | undefined) => {
  if (!v) return '—';
  const d = v.replace(/\D/g, '');
  if (d.length === 11) return d.replace(/(\d{2})(\d{5})(\d{4})/, '($1) $2-$3');
  if (d.length === 10) return d.replace(/(\d{2})(\d{4})(\d{4})/, '($1) $2-$3');
  return v;
};
