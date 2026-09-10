'use client';

import * as Dialog from '@radix-ui/react-dialog';
import type { OrderDetail } from '@ordens/contracts';
import { Button, Field, Input, Textarea } from '@ordens/ui';
import { PackageCheck } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { ApiRequestError } from '@/lib/api';
import { addDec, cmpDec, mulDec, subDec } from '@/lib/decimal';
import { formatQty, parseDecimalInput } from '@/lib/format';
import { useCreateRelease } from './orders-api';

export function ReleaseDialog({ order, open, onOpenChange }: { order: OrderDetail; open: boolean; onOpenChange: (o: boolean) => void }) {
  const [qty, setQty] = useState('');
  const [validUntil, setValidUntil] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const mutation = useCreateRelease(order.id);
  const q = order.quantities;
  const max = mulDec(q.total, addDec('1', mulDec(order.tolerancePct, '0.01', 6) ?? '0'), 4) ?? q.total;
  const available = subDec(max, q.released);
  const parsed = parseDecimalInput(qty);
  const exceeds = parsed && cmpDec(parsed, available) > 0;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const d = await mutation.mutateAsync({ quantity: parsed, validUntil: validUntil || null, notes: notes || null, expectedVersion: order.version });
      toast.success(`Liberação de ${formatQty(parsed, q.unit)} criada`, { description: `Ordem ${d.number} agora na versão ${d.version}` });
      onOpenChange(false);
      setQty('');
      setNotes('');
      setValidUntil('');
    } catch (err) {
      setError(err instanceof ApiRequestError ? (err.fieldErrors.quantity?.[0] ?? err.message) : 'Não foi possível liberar.');
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[60] bg-[var(--overlay)] data-[state=open]:animate-in data-[state=open]:fade-in" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-[61] w-[min(480px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 rounded-xl bg-surface shadow-lg ring-1 ring-border data-[state=open]:animate-in data-[state=open]:fade-in data-[state=open]:zoom-in-95">
          <form onSubmit={submit}>
            <div className="flex items-start gap-3 border-b border-border/70 p-5">
              <span className="grid size-10 place-items-center rounded-lg bg-primary-soft text-primary">
                <PackageCheck className="size-5" />
              </span>
              <div>
                <Dialog.Title className="text-base font-semibold">Nova liberação parcial</Dialog.Title>
                <Dialog.Description className="text-sm text-muted">
                  Ordem {order.number} · gera a versão {order.version + 1} e notifica a Fazenda
                </Dialog.Description>
              </div>
            </div>
            <div className="space-y-4 p-5">
              <div className="grid grid-cols-3 gap-2 rounded-lg bg-surface-2 p-3 text-center text-xs">
                <div>
                  <div className="text-subtle">Quantidade</div>
                  <div className="mt-0.5 font-semibold tabular">{formatQty(q.total, q.unit)}</div>
                </div>
                <div>
                  <div className="text-subtle">Já liberado</div>
                  <div className="mt-0.5 font-semibold tabular">{formatQty(q.released, q.unit)}</div>
                </div>
                <div>
                  <div className="text-subtle">Disponível</div>
                  <div className="mt-0.5 font-semibold text-primary tabular">{formatQty(available, q.unit)}</div>
                </div>
              </div>
              <Field label={`Quantidade a liberar (${q.unit})`} required error={error ?? (exceeds ? 'Maior que o disponível para liberar' : undefined)}>
                {(a) => <Input {...a} autoFocus inputMode="decimal" className="text-right text-base tabular" value={qty} onChange={(e) => setQty(e.target.value)} placeholder="0,000" />}
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Validade" hint="Opcional">
                  {(a) => <Input {...a} type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />}
                </Field>
              </div>
              <Field label="Observação">
                {(a) => <Textarea {...a} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />}
              </Field>
            </div>
            <div className="flex justify-end gap-2 border-t border-border/70 px-5 py-3">
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              <Button type="submit" loading={mutation.isPending} disabled={!parsed || Boolean(exceeds)}>
                Liberar
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
