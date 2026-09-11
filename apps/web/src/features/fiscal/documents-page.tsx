'use client';

import { DOCUMENT_KIND_LABELS, DOCUMENT_VISIBILITY_LABELS, type DocumentDto, type DocumentKind, type DocumentVisibility } from '@ordens/contracts';
import { Button, Card, cn, EmptyState, Input, Skeleton } from '@ordens/ui';
import { Download, FileImage, FileSpreadsheet, FileText, FolderOpen, Loader2, Search, ShieldAlert } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { ApiRequestError } from '@/lib/api';
import { formatRelative } from '@/lib/format';
import { useMe } from '@/lib/session';
import { InvoiceStatusBadge, VisibilityBadge } from './badges';
import { downloadDocument, useDocumentMutations, useDocuments } from './fiscal-api';

const KIND_ICON: Record<DocumentKind, typeof FileText> = { NFE_XML: FileSpreadsheet, PDF: FileText, IMAGE: FileImage, SPREADSHEET: FileSpreadsheet, OTHER: FileText };
const UPLOAD_STATUS: Record<string, string> = { UPLOADED: 'Verificando…', PROCESSING: 'Verificando…', AVAILABLE: 'Disponível', REJECTED: 'Rejeitado', INFECTED: 'Bloqueado' };
const fmtSize = (b: number) => (b > 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

function entityHref(d: DocumentDto): string | null {
  switch (d.entity.type) {
    case 'loading_order':
      return `/ordens/${d.entity.id}`;
    case 'load':
      return `/cargas?abrir=${d.entity.id}`;
    case 'occurrence':
      return d.order ? `/ordens/${d.order.id}` : '/ocorrencias';
    case 'contract':
      return '/contratos';
    default:
      return null;
  }
}

export function DocumentsPage({ entityId, embedded }: { entityId?: string; embedded?: boolean }) {
  const { data: me } = useMe();
  const isMatriz = me?.activeMembership?.scope === 'MATRIZ';
  const [kind, setKind] = useState<DocumentKind | 'all'>('all');
  const [visibility, setVisibility] = useState<DocumentVisibility | 'all'>('all');
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const { visibility: changeVisibility } = useDocumentMutations();

  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const list = useDocuments({ q: q || undefined, entityId, kind: kind === 'all' ? undefined : [kind], visibility: visibility === 'all' ? undefined : visibility, pageSize: 200 });
  const items = list.data?.items ?? [];

  const onVisibility = async (d: DocumentDto, next: DocumentVisibility) => {
    try {
      await changeVisibility.mutateAsync({ id: d.id, visibility: next });
      toast.success(`${d.fileName}: ${DOCUMENT_VISIBILITY_LABELS[next]}`);
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : 'Não foi possível alterar a visibilidade.');
    }
  };

  const onDownload = async (d: DocumentDto) => {
    try {
      await downloadDocument(d.id);
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : 'Não foi possível baixar o documento.');
    }
  };

  const body = (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-border/70 p-3">
        <div className="-mx-1 flex min-w-0 flex-1 items-center gap-1 overflow-x-auto px-1" role="radiogroup" aria-label="Tipo de documento">
          {(['all', ...Object.keys(DOCUMENT_KIND_LABELS)] as (DocumentKind | 'all')[]).map((k) => (
            <button
              key={k}
              role="radio"
              aria-checked={kind === k}
              onClick={() => setKind(k)}
              className={cn('h-8 shrink-0 rounded-full px-3 text-[13px] font-medium', kind === k ? 'bg-primary-soft text-primary ring-1 ring-primary/20' : 'text-muted hover:bg-surface-2 hover:text-text')}
            >
              {k === 'all' ? 'Todos' : DOCUMENT_KIND_LABELS[k]}
            </button>
          ))}
        </div>
        {isMatriz ? (
          <select aria-label="Visibilidade" value={visibility} onChange={(e) => setVisibility(e.target.value as DocumentVisibility | 'all')} className="h-9 w-full rounded-md bg-surface px-2.5 text-sm ring-1 ring-border sm:w-auto">
            <option value="all">Qualquer visibilidade</option>
            {(Object.keys(DOCUMENT_VISIBILITY_LABELS) as DocumentVisibility[]).map((v) => (
              <option key={v} value={v}>
                {DOCUMENT_VISIBILITY_LABELS[v]}
              </option>
            ))}
          </select>
        ) : null}
        {!embedded ? (
          <div className="relative w-full sm:w-64">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Nome do arquivo…" className="pl-9" aria-label="Buscar documentos" />
          </div>
        ) : null}
      </div>

      {list.isLoading ? (
        <div className="space-y-2 p-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-12" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState icon={<FolderOpen />} title="Nenhum documento" description={isMatriz ? 'Ajuste os filtros.' : 'Documentos compartilhados com sua organização aparecem aqui.'} />
      ) : (
        <ul className="divide-y divide-border/70">
          {items.map((d) => {
            const Icon = KIND_ICON[d.kind];
            const href = entityHref(d);
            const processing = d.status === 'UPLOADED' || d.status === 'PROCESSING';
            const blocked = d.status === 'REJECTED' || d.status === 'INFECTED';
            return (
              <li key={d.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-4">
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <span className={cn('grid size-9 shrink-0 place-items-center rounded-lg', blocked ? 'bg-danger-soft text-danger' : 'bg-primary-soft text-primary')}>
                    {processing ? <Loader2 className="size-4 animate-spin" /> : blocked ? <ShieldAlert className="size-4" /> : <Icon className="size-4" />}
                  </span>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{d.fileName}</div>
                    <div className="truncate text-xs text-muted">
                      {DOCUMENT_KIND_LABELS[d.kind]} · {fmtSize(Number(d.sizeBytes))}
                      {!embedded && d.entity.label ? (
                        <>
                          {' · '}
                          {href ? (
                            <Link href={href} className="text-primary hover:underline">
                              {d.entity.label}
                            </Link>
                          ) : (
                            d.entity.label
                          )}
                        </>
                      ) : null}
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {d.invoiceStatus ? <InvoiceStatusBadge status={d.invoiceStatus} /> : null}
                  {!d.invoiceStatus || blocked || processing ? <span className={cn('text-xs', blocked ? 'text-danger' : 'text-muted')}>{UPLOAD_STATUS[d.status] ?? d.status}</span> : null}
                  {d.canChangeVisibility ? (
                    <select
                      aria-label={`Visibilidade de ${d.fileName}`}
                      value={d.visibility}
                      disabled={changeVisibility.isPending}
                      onChange={(e) => void onVisibility(d, e.target.value as DocumentVisibility)}
                      className="h-8 rounded-md bg-surface px-2 text-xs ring-1 ring-border"
                    >
                      {(Object.keys(DOCUMENT_VISIBILITY_LABELS) as DocumentVisibility[]).map((v) => (
                        <option key={v} value={v}>
                          {DOCUMENT_VISIBILITY_LABELS[v]}
                        </option>
                      ))}
                    </select>
                  ) : isMatriz ? (
                    <VisibilityBadge visibility={d.visibility} />
                  ) : null}
                </div>
                <div className="flex items-center gap-2 sm:w-56 sm:justify-end">
                  <div className="min-w-0 text-right text-xs text-muted">
                    <div className="truncate">{d.uploadedBy ?? d.organization ?? '—'}</div>
                    <div>{formatRelative(d.createdAt)}</div>
                  </div>
                  <Button variant="ghost" size="icon-sm" aria-label={`Baixar ${d.fileName}`} disabled={d.status !== 'AVAILABLE'} onClick={() => void onDownload(d)}>
                    <Download />
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );

  if (embedded) return body;
  return (
    <div className="mx-auto flex max-w-[1800px] flex-col gap-5 px-4 py-6 sm:px-6 lg:px-8">
      <div className="flex items-center gap-3.5">
        <span className="grid size-11 place-items-center rounded-xl bg-primary-soft text-primary">
          <FolderOpen className="size-5" />
        </span>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Central de Documentos</h1>
          <p className="text-sm text-muted">
            {isMatriz ? 'Todos os arquivos das ordens, cargas e ocorrências, com controle de quem pode ver.' : 'Documentos compartilhados com sua organização.'}
          </p>
        </div>
      </div>
      {body}
    </div>
  );
}
