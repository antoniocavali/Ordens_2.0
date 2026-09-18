'use client';

import * as AlertDialog from '@radix-ui/react-dialog';
import { Button } from '@ordens/ui';

/** Confirmação de ação: `danger` para descartar ou excluir, `primary` para seguir apesar de um aviso. */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  onCancel,
  onConfirm,
  tone = 'danger',
  cancelLabel = 'Continuar editando',
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
  tone?: 'danger' | 'primary';
  cancelLabel?: string;
}) {
  return (
    <AlertDialog.Root open={open} onOpenChange={(o) => !o && onCancel()}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-[70] bg-[var(--overlay)] data-[state=open]:animate-in data-[state=open]:fade-in" />
        <AlertDialog.Content className="fixed left-1/2 top-1/2 z-[71] w-[min(420px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 rounded-xl bg-surface p-6 shadow-lg ring-1 ring-border data-[state=open]:animate-in data-[state=open]:fade-in data-[state=open]:zoom-in-95">
          <AlertDialog.Title className="text-base font-semibold">{title}</AlertDialog.Title>
          <AlertDialog.Description className="mt-2 text-sm text-muted">{description}</AlertDialog.Description>
          <div className="mt-6 flex justify-end gap-2">
            <Button variant="ghost" onClick={onCancel}>
              {cancelLabel}
            </Button>
            <Button variant={tone === 'danger' ? 'danger' : 'primary'} onClick={onConfirm}>
              {confirmLabel}
            </Button>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
