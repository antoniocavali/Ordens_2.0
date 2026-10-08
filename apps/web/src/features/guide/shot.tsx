'use client';

import * as Dialog from '@radix-ui/react-dialog';
import { cn } from '@ordens/ui';
import { Expand, X } from 'lucide-react';
import type { GuideShot } from './guide-content';

export const shotSrc = (file: string) => `/guia/${file}.webp`;

/** Captura de tela emoldurada; clicar amplia. As imagens têm 1440 × 900. */
export function Shot({ shot, className, eager }: { shot: GuideShot; className?: string; eager?: boolean }) {
  return (
    <Dialog.Root>
      <Dialog.Trigger asChild>
        <button
          type="button"
          aria-label={`Ampliar: ${shot.alt}`}
          className={cn('group relative block w-full overflow-hidden rounded-lg bg-surface-2 ring-1 ring-border transition hover:ring-primary/50 focus-visible:outline-2 focus-visible:outline-ring', className)}
        >
          <img src={shotSrc(shot.file)} alt={shot.alt} width={1440} height={900} loading={eager ? 'eager' : 'lazy'} decoding="async" className="block h-auto w-full" />
          <span className="absolute right-2 top-2 grid size-8 place-items-center rounded-md bg-black/55 text-white opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100">
            <Expand className="size-4" />
          </span>
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[80] bg-black/80" />
        <Dialog.Content className="fixed inset-0 z-[81] flex items-center justify-center p-4 sm:p-8" aria-describedby={undefined}>
          <Dialog.Title className="sr-only">{shot.alt}</Dialog.Title>
          <img src={shotSrc(shot.file)} alt={shot.alt} width={1440} height={900} className="max-h-full w-auto max-w-full rounded-lg shadow-2xl" />
          <Dialog.Close aria-label="Fechar" className="absolute right-4 top-4 grid size-10 place-items-center rounded-full bg-white/15 text-white hover:bg-white/25">
            <X className="size-5" />
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
