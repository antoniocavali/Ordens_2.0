'use client';

import * as Dialog from '@radix-ui/react-dialog';
import { Button, Field, Input, Textarea } from '@ordens/ui';
import { useEffect, useState } from 'react';

/** Confirmação com motivo obrigatório (cancelamentos, não comparecimento). */
export function ReasonDialog({
  open,
  title,
  description,
  confirmLabel,
  onCancel,
  onConfirm,
  loading,
  tone = 'danger',
  fieldLabel = 'Motivo',
  confirmText,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
  loading?: boolean;
  /** `primary` para confirmações não destrutivas (ex.: resolver ocorrência). */
  tone?: 'danger' | 'primary';
  fieldLabel?: string;
  /** Texto que a pessoa precisa digitar para liberar o botão (ações que não têm volta). */
  confirmText?: string;
}) {
  const [reason, setReason] = useState('');
  const [typed, setTyped] = useState('');
  useEffect(() => {
    if (open) {
      setReason('');
      setTyped('');
    }
  }, [open]);
  const typedOk = !confirmText || typed.trim() === confirmText;
  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onCancel()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[70] bg-[var(--overlay)]" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-[71] w-[min(440px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 rounded-xl bg-surface p-6 shadow-lg ring-1 ring-border">
          <Dialog.Title className="text-base font-semibold">{title}</Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-muted">{description}</Dialog.Description>
          <Field label={fieldLabel} required className="mt-4">
            {(a) => <Textarea {...a} autoFocus rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />}
          </Field>
          {confirmText ? (
            <Field label={`Digite ${confirmText} para confirmar`} required className="mt-3">
              {(a) => <Input {...a} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" className="font-mono" />}
            </Field>
          ) : null}
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="ghost" onClick={onCancel}>
              Voltar
            </Button>
            <Button variant={tone === 'primary' ? 'primary' : 'danger'} disabled={reason.trim().length < 3 || !typedOk} loading={loading} onClick={() => onConfirm(reason.trim())}>
              {confirmLabel}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
