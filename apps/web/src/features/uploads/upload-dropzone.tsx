'use client';

import type { UploadDto } from '@ordens/contracts';
import { Button, cn } from '@ordens/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, FileText, Loader2, RotateCcw, ShieldAlert, UploadCloud, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useCallback, useRef, useState, type DragEvent } from 'react';
import { ApiRequestError, get } from '@/lib/api';
import { uploadFile, type UploadEntityType } from './uploader';

interface QueueItem {
  key: string;
  file: File;
  loaded: number;
  status: 'uploading' | 'done' | 'error' | 'cancelled';
  error?: string;
  controller: AbortController;
}

const STATUS_LABEL: Record<string, string> = {
  UPLOADED: 'Verificando…',
  PROCESSING: 'Verificando…',
  AVAILABLE: 'Disponível',
  REJECTED: 'Rejeitado',
  INFECTED: 'Bloqueado (malware)',
};

const fmtSize = (b: number) => (b > 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

/** Envio de documentos com fila visual, progresso individual, cancelamento e retentativa. */
export function UploadDropzone({
  entityType = 'loading_order',
  entityId,
  disabledReason,
  accept = '.pdf,.xml,.jpg,.jpeg,.png,.webp,.csv,.xlsx,.zip',
  title = 'Arraste arquivos ou clique para selecionar',
  hint = 'PDF, imagens, planilhas e XML · envio direto e seguro para o armazenamento',
  showExisting = true,
}: {
  entityType?: UploadEntityType;
  entityId: string | null;
  disabledReason?: string;
  accept?: string;
  title?: string;
  hint?: string;
  showExisting?: boolean;
}) {
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();

  const existing = useQuery({
    queryKey: ['uploads', entityType, entityId],
    queryFn: () => get<UploadDto[]>('/uploads', { entityType, entityId }),
    enabled: Boolean(entityId) && showExisting,
    refetchInterval: (q) => (q.state.data?.some((u) => u.status === 'UPLOADED' || u.status === 'PROCESSING') ? 2000 : false),
  });

  const start = useCallback(
    (file: File, key = `${file.name}-${file.size}-${Date.now()}`) => {
      if (!entityId) return;
      const controller = new AbortController();
      setQueue((q) => [...q.filter((i) => i.key !== key), { key, file, loaded: 0, status: 'uploading', controller }]);
      uploadFile({
        file,
        entityType,
        entityId,
        signal: controller.signal,
        onProgress: ({ loaded }) => setQueue((q) => q.map((i) => (i.key === key ? { ...i, loaded } : i))),
      })
        .then(() => {
          setQueue((q) => q.map((i) => (i.key === key ? { ...i, status: 'done', loaded: file.size } : i)));
          void qc.invalidateQueries({ queryKey: ['uploads', entityType, entityId] });
          // NF-e e central de documentos são atualizadas pelo worker logo após a verificação.
          void qc.invalidateQueries({ queryKey: ['fiscal'] });
          setTimeout(() => setQueue((q) => q.filter((i) => i.key !== key)), 1500);
        })
        .catch((err: Error) => {
          const cancelled = err.name === 'AbortError';
          setQueue((q) =>
            q.map((i) =>
              i.key === key ? { ...i, status: cancelled ? 'cancelled' : 'error', error: err instanceof ApiRequestError ? err.message : 'Falha no envio. Tente novamente.' } : i,
            ),
          );
        });
    },
    [entityId, entityType, qc],
  );

  const onFiles = (files: FileList | null) => files && Array.from(files).forEach((f) => start(f));
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    onFiles(e.dataTransfer.files);
  };

  const total = queue.reduce((a, i) => a + i.file.size, 0);
  const loaded = queue.reduce((a, i) => a + i.loaded, 0);

  return (
    <div className="space-y-3">
      <div
        role="button"
        tabIndex={entityId ? 0 : -1}
        aria-disabled={!entityId}
        onClick={() => entityId && input.current?.click()}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && entityId && input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          if (entityId) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cn(
          'flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-6 py-7 text-center transition',
          entityId ? 'cursor-pointer border-border-strong hover:border-primary/60 hover:bg-primary-soft/40' : 'cursor-not-allowed border-border opacity-60',
          dragging && 'border-primary bg-primary-soft/60',
        )}
      >
        <motion.div animate={dragging ? { y: -4, scale: 1.05 } : { y: 0, scale: 1 }} className="grid size-10 place-items-center rounded-full bg-primary-soft text-primary">
          <UploadCloud className="size-5" />
        </motion.div>
        <div className="text-sm font-medium">{entityId ? title : (disabledReason ?? 'Indisponível')}</div>
        <div className="text-xs text-subtle">{hint}</div>
        <input ref={input} type="file" multiple hidden onChange={(e) => onFiles(e.target.files)} accept={accept} />
      </div>

      {queue.length > 1 ? (
        <div className="flex items-center gap-3 text-xs text-muted">
          <div className="h-1 flex-1 overflow-hidden rounded-full bg-surface-3">
            <div className="h-full bg-primary transition-[width]" style={{ width: `${total ? (loaded / total) * 100 : 0}%` }} />
          </div>
          {fmtSize(loaded)} de {fmtSize(total)}
        </div>
      ) : null}

      <ul className="space-y-2">
        <AnimatePresence initial={false}>
          {queue.map((item) => (
            <motion.li key={item.key} layout initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="rounded-md bg-surface-2 px-3 py-2.5">
              <div className="flex items-center gap-3">
                <FileText className="size-4 shrink-0 text-muted" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm">{item.file.name}</div>
                  <div className={cn('text-xs', item.status === 'error' ? 'text-danger' : 'text-subtle')}>
                    {item.status === 'error' ? item.error : item.status === 'cancelled' ? 'Cancelado' : `${fmtSize(item.loaded)} de ${fmtSize(item.file.size)}`}
                  </div>
                </div>
                {item.status === 'uploading' ? (
                  <Button variant="ghost" size="icon-sm" aria-label="Cancelar envio" onClick={() => item.controller.abort()}>
                    <X />
                  </Button>
                ) : item.status === 'done' ? (
                  <CheckCircle2 className="size-4 text-success" />
                ) : (
                  <Button variant="ghost" size="icon-sm" aria-label="Tentar novamente" onClick={() => start(item.file, item.key)}>
                    <RotateCcw />
                  </Button>
                )}
              </div>
              {item.status === 'uploading' ? (
                <div className="mt-2 h-1 overflow-hidden rounded-full bg-surface-3">
                  <div className="h-full bg-primary transition-[width] duration-200" style={{ width: `${(item.loaded / item.file.size) * 100}%` }} />
                </div>
              ) : null}
            </motion.li>
          ))}
        </AnimatePresence>
        {showExisting
          ? existing.data?.map((u) => (
              <li key={u.id} className="flex items-center gap-3 rounded-md px-3 py-2 ring-1 ring-border/70">
                {u.status === 'AVAILABLE' ? (
                  <FileText className="size-4 text-primary" />
                ) : u.status === 'REJECTED' || u.status === 'INFECTED' ? (
                  <ShieldAlert className="size-4 text-danger" />
                ) : (
                  <Loader2 className="size-4 animate-spin text-muted" />
                )}
                <span className="min-w-0 flex-1 truncate text-sm">{u.fileName}</span>
                <span className="text-xs text-subtle">{fmtSize(Number(u.sizeBytes))}</span>
                <span className={cn('text-xs', u.status === 'AVAILABLE' ? 'text-success' : u.status === 'REJECTED' || u.status === 'INFECTED' ? 'text-danger' : 'text-muted')}>
                  {STATUS_LABEL[u.status] ?? u.status}
                </span>
              </li>
            ))
          : null}
      </ul>
    </div>
  );
}
