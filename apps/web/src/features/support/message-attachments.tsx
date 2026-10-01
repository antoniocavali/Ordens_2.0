'use client';

import type { SupportAttachmentDto } from '@ordens/contracts';
import { Button, cn } from '@ordens/ui';
import { ImageOff, Loader2, ShieldAlert } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { supportAttachmentUrl } from './support-api';

const SIZE = (bytes: string) => {
  const n = Number(bytes);
  return n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
};

/**
 * Miniaturas das imagens de uma mensagem. A imagem só abre quando passou pela verificação; antes
 * disso o endereço nem existe, então não há o que clicar.
 */
export function MessageAttachments({ attachments }: { attachments: SupportAttachmentDto[] }) {
  const [opening, setOpening] = useState<string | null>(null);
  if (!attachments.length) return null;

  const open = async (a: SupportAttachmentDto) => {
    setOpening(a.id);
    try {
      window.open(await supportAttachmentUrl(a.id), '_blank', 'noopener,noreferrer');
    } catch {
      toast.error('Não foi possível abrir a imagem.');
    } finally {
      setOpening(null);
    }
  };

  return (
    <ul className="mt-2 flex flex-wrap gap-2">
      {attachments.map((a) => {
        const blocked = ['REJECTED', 'INFECTED', 'REMOVED'].includes(a.status);
        const ready = a.status === 'AVAILABLE';
        return (
          <li key={a.id}>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!ready || opening === a.id}
              onClick={() => void open(a)}
              className={cn('max-w-56 justify-start gap-2', blocked && 'text-danger')}
              aria-label={ready ? `Abrir ${a.fileName}` : a.fileName}
            >
              {ready ? null : blocked ? <ShieldAlert /> : <Loader2 className="animate-spin" />}
              {a.status === 'REMOVED' ? <ImageOff /> : null}
              <span className="min-w-0 truncate">{a.fileName}</span>
              <span className="shrink-0 text-xs text-subtle">
                {a.status === 'REMOVED'
                  ? 'removida'
                  : blocked
                    ? 'bloqueada'
                    : ready
                      ? SIZE(a.sizeBytes)
                      : 'Verificando captura'}
              </span>
            </Button>
          </li>
        );
      })}
    </ul>
  );
}
