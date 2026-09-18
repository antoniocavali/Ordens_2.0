'use client';

import { useCallback, useRef, useState, type ReactNode } from 'react';
import { ConfirmDialog } from './confirm-dialog';

/**
 * Q39: o destino é opcional, mas publicar ou enviar uma ordem sem ele pede confirmação.
 * `confirmThen(hasDestination, action)` executa direto quando há destino; sem destino, abre a confirmação.
 */
export function useNoDestinationConfirm(actionLabel: string): [(hasDestination: boolean, action: () => void) => void, ReactNode] {
  const [open, setOpen] = useState(false);
  const pending = useRef<(() => void) | null>(null);

  const confirmThen = useCallback((hasDestination: boolean, action: () => void) => {
    if (hasDestination) return action();
    pending.current = action;
    setOpen(true);
  }, []);

  const dialog = (
    <ConfirmDialog
      open={open}
      title="Ordem sem destino"
      description="Esta ordem não tem destino informado. A Fazenda e o Comprador verão o destino como não definido. Deseja continuar mesmo assim?"
      confirmLabel={actionLabel}
      tone="primary"
      onCancel={() => {
        pending.current = null;
        setOpen(false);
      }}
      onConfirm={() => {
        setOpen(false);
        const action = pending.current;
        pending.current = null;
        action?.();
      }}
    />
  );
  return [confirmThen, dialog];
}
