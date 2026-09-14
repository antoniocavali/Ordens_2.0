'use client';

import * as Dialog from '@radix-ui/react-dialog';
import { Button, Field, Textarea } from '@ordens/ui';
import { PackageX } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { ApiRequestError } from '@/lib/api';
import { formatQty } from '@/lib/format';
import { useCancelRelease } from './orders-api';

export interface CancelReleaseTarget {
  orderId: string;
  orderNumber: string;
  /** Versão atual da ordem (concorrência otimista). */
  orderVersion: number;
  releaseId: string;
  sequence: number;
  quantity: string;
  unit: string;
}

export function CancelReleaseDialog({ target, onClose }: { target: CancelReleaseTarget | null; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const mutation = useCancelRelease();

  useEffect(() => {
    if (target) {
      setReason('');
      setError(null);
    }
  }, [target]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!target) return;
    setError(null);
    try {
      const d = await mutation.mutateAsync({ orderId: target.orderId, releaseId: target.releaseId, reason: reason.trim(), expectedVersion: target.orderVersion });
      toast.success(`Liberação ${String(target.sequence).padStart(2, '0')} cancelada`, { description: `Ordem ${d.number} agora na versão ${d.version}` });
      onClose();
    } catch (err) {
      setError(err instanceof ApiRequestError ? (err.fieldErrors.reason?.[0] ?? err.message) : 'Não foi possível cancelar a liberação.');
    }
  };

  return (
    <Dialog.Root open={target !== null} onOpenChange={(o) => (!o ? onClose() : undefined)}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[60] bg-[var(--overlay)] data-[state=open]:animate-in data-[state=open]:fade-in" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-[61] w-[min(480px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 rounded-xl bg-surface shadow-lg ring-1 ring-border data-[state=open]:animate-in data-[state=open]:fade-in data-[state=open]:zoom-in-95">
          {target ? (
            <form onSubmit={submit}>
              <div className="flex items-start gap-3 border-b border-border/70 p-5">
                <span className="grid size-10 place-items-center rounded-lg bg-danger-soft text-danger">
                  <PackageX className="size-5" />
                </span>
                <div>
                  <Dialog.Title className="text-base font-semibold">Cancelar liberação {String(target.sequence).padStart(2, '0')}</Dialog.Title>
                  <Dialog.Description className="text-sm text-muted">
                    Ordem {target.orderNumber} · {formatQty(target.quantity, target.unit)} deixam de estar liberados. Gera a versão {target.orderVersion + 1} e avisa a Fazenda.
                  </Dialog.Description>
                </div>
              </div>
              <div className="space-y-3 p-5">
                <Field label="Motivo do cancelamento" required hint="Fica registrado na auditoria e visível só para a Matriz." error={error ?? undefined}>
                  {(a) => <Textarea {...a} autoFocus rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />}
                </Field>
                <p className="text-xs text-subtle">O cancelamento é definitivo. Para liberar de novo, crie uma nova liberação.</p>
              </div>
              <div className="flex justify-end gap-2 border-t border-border/70 px-5 py-3">
                <Button type="button" variant="ghost" onClick={onClose}>
                  Voltar
                </Button>
                <Button type="submit" variant="danger" loading={mutation.isPending} disabled={reason.trim().length < 3}>
                  Cancelar liberação
                </Button>
              </div>
            </form>
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
