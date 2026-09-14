'use client';

import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import type { ReactNode } from 'react';
import { cn } from './cn';

export interface DrawerProps {
  open: boolean;
  /** Chamado ao pedir fechamento (ESC, backdrop, botão). Use para confirmar alterações não salvas. */
  onRequestClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  headerAside?: ReactNode;
  toolbar?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  /** Largura: md ≈ 560px, lg ≈ 760–960px (até 45vw em telas grandes). Mobile: tela cheia. */
  size?: 'md' | 'lg';
  side?: 'right';
  className?: string;
  describedBy?: string;
  /** false: o conteúdo gerencia a própria rolagem (ex.: scrollspy de seções). */
  bodyScroll?: boolean;
}

const widths = {
  md: 'sm:w-[min(560px,100vw)]',
  lg: 'sm:w-[min(100vw,max(760px,min(45vw,960px)))] 2xl:w-[min(100vw,max(860px,45vw))]',
};

/** Janela lateral estilo "cortina": full-height, focus trap, ESC, cabeçalho e rodapé fixos. */
export function Drawer({ open, onRequestClose, title, subtitle, headerAside, toolbar, footer, children, size = 'lg', className, bodyScroll = true }: DrawerProps) {
  const reduce = useReducedMotion();
  return (
    <Dialog.Root open={open} onOpenChange={(o) => (!o ? onRequestClose() : undefined)}>
      <AnimatePresence>
        {open ? (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild forceMount>
              <motion.div
                className="fixed inset-0 z-50 bg-[var(--overlay)] backdrop-blur-[2px]"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: reduce ? 0 : 0.2 }}
              />
            </Dialog.Overlay>
            <Dialog.Content asChild forceMount aria-describedby={undefined}>
              <motion.div
                className={cn(
                  'fixed inset-y-0 right-0 z-50 flex w-full flex-col bg-surface shadow-drawer outline-none sm:rounded-l-xl',
                  widths[size],
                  className,
                )}
                initial={reduce ? { opacity: 0 } : { x: '100%' }}
                animate={reduce ? { opacity: 1 } : { x: 0 }}
                exit={reduce ? { opacity: 0 } : { x: '100%' }}
                transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 380, damping: 38, mass: 0.9 }}
              >
                <header className="shrink-0 border-b border-border/70 px-5 pb-0 pt-4 sm:px-7">
                  <div className="flex items-start gap-4 pb-3">
                    <div className="min-w-0 flex-1">
                      <Dialog.Title className="truncate text-lg font-semibold tracking-tight">{title}</Dialog.Title>
                      {subtitle ? <div className="mt-0.5 text-[13px] text-muted">{subtitle}</div> : null}
                    </div>
                    {headerAside}
                    <Dialog.Close
                      className="grid size-8 shrink-0 place-items-center rounded-md text-muted transition hover:bg-surface-2 hover:text-text"
                      aria-label="Fechar"
                    >
                      <X className="size-4" />
                    </Dialog.Close>
                  </div>
                  {toolbar}
                </header>
                <div className={cn('min-h-0 flex-1', bodyScroll ? 'overflow-y-auto overscroll-contain' : 'overflow-hidden')}>{children}</div>
                {footer ? <footer className="shrink-0 border-t border-border/70 bg-surface px-5 py-3 sm:px-7">{footer}</footer> : null}
              </motion.div>
            </Dialog.Content>
          </Dialog.Portal>
        ) : null}
      </AnimatePresence>
    </Dialog.Root>
  );
}
