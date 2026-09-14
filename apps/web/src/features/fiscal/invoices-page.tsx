'use client';

import { INVOICE_ORIGIN_LABELS, INVOICE_REJECT_LABELS, type InvoiceDto } from '@ordens/contracts';
import { Button, Card, cn, Drawer, EmptyState, Input, Skeleton } from '@ordens/ui';
import { AlertTriangle, Copy, Download, FileSpreadsheet, Search, XCircle } from 'lucide-react';
import { motion } from 'motion/react';
import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { ReasonDialog } from '@/features/logistics/reason-dialog';
import { Stat } from '@/features/registry/form-utils';
import { ApiRequestError } from '@/lib/api';
import { formatDateTime, formatMoney, formatQty, formatRelative } from '@/lib/format';
import { InvoiceStatusBadge } from './badges';
import { downloadDocument, useInvoiceMutations, useInvoices } from './fiscal-api';

const formatKey = (key: string | null) => (key ? key.replace(/(\d{4})(?=\d)/g, '$1 ') : '—');
const formatDoc = (d: string | null) =>
  !d ? '—' : d.length === 14 ? d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : d.length === 11 ? d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4') : d;

function Row({ label, children, mono }: { label: string; children: ReactNode; mono?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-4">
      <dt className="w-40 shrink-0 text-xs text-muted">{label}</dt>
      <dd className={cn('min-w-0 wrap-break-word text-sm', mono && 'font-mono text-[13px]')}>{children}</dd>
    </div>
  );
}

/** Detalhe da NF-e: dados extraídos, divergências, rejeição, download e cancelamento. */
export function InvoiceDrawer({ invoice, onClose }: { invoice: InvoiceDto | null; onClose: () => void }) {
  const { cancel } = useInvoiceMutations();
  const [cancelling, setCancelling] = useState(false);
  const i = invoice;

  const doCancel = async (reason: string) => {
    if (!i) return;
    try {
      await cancel.mutateAsync({ id: i.id, reason });
      toast.success(`NF-e ${i.number ?? ''} cancelada`);
      setCancelling(false);
      onClose();
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : 'Não foi possível cancelar a NF-e.');
    }
  };

  return (
    <>
      <Drawer
        open={Boolean(i)}
        size="md"
        onRequestClose={onClose}
        title={i ? (i.number ? `NF-e ${i.number}${i.series ? ` · série ${i.series}` : ''}` : 'XML rejeitado') : ''}
        subtitle={
          i ? (
            <span className="flex flex-wrap items-center gap-2">
              <InvoiceStatusBadge status={i.status} />
              <span>Origem: {INVOICE_ORIGIN_LABELS[i.origin]}</span>
              <span>
                · Carga <span className="font-mono">{i.load.number}</span>
              </span>
            </span>
          ) : null
        }
        footer={
          i ? (
            <div className="flex flex-wrap items-center gap-2">
              {i.canCancel ? (
                <Button variant="ghost" size="sm" onClick={() => setCancelling(true)}>
                  <XCircle /> Cancelar NF-e
                </Button>
              ) : null}
              <div className="ml-auto flex gap-2">
                {i.fileUploadId ? (
                  <Button variant="outline" onClick={() => void downloadDocument(i.fileUploadId!)}>
                    <Download /> Baixar XML
                  </Button>
                ) : null}
                <Button variant="ghost" onClick={onClose}>
                  Fechar
                </Button>
              </div>
            </div>
          ) : null
        }
      >
        {i ? (
          <div className="space-y-5 p-5 sm:p-7">
            {i.rejectReason ? (
              <div className="flex gap-3 rounded-lg bg-danger-soft p-4 text-sm">
                <XCircle className="mt-0.5 size-4 shrink-0 text-danger" />
                <div>
                  <div className="font-semibold text-danger">Rejeitada: {INVOICE_REJECT_LABELS[i.rejectReason]}</div>
                  <div className="text-muted">Corrija o arquivo e envie novamente. A nota rejeitada não conta para o faturamento.</div>
                </div>
              </div>
            ) : null}
            {i.divergences.length ? (
              <div className="rounded-lg bg-warning-soft p-4 text-sm">
                <div className="mb-2 flex items-center gap-2 font-semibold text-warning">
                  <AlertTriangle className="size-4" /> {i.divergences.length === 1 ? '1 divergência' : `${i.divergences.length} divergências`}
                </div>
                <ul className="space-y-2">
                  {i.divergences.map((d) => (
                    <li key={d.code}>
                      <div className="font-medium">{d.message}</div>
                      {d.expected || d.actual ? (
                        <div className="text-xs text-muted">
                          Esperado: <span className="font-mono">{d.expected ?? '—'}</span> · Na nota: <span className="font-mono">{d.actual ?? '—'}</span>
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {i.cancelReason ? (
              <div className="rounded-lg bg-surface-2 p-4 text-sm">
                <div className="text-xs font-semibold uppercase tracking-wider text-muted">Motivo do cancelamento</div>
                {i.cancelReason}
              </div>
            ) : null}

            {i.number ? (
              <>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <Stat label="Valor total" value={i.totalValue ? formatMoney(i.totalValue) : '—'} />
                  <Stat label="Peso líquido" value={i.netWeightKg ? formatQty(i.netWeightKg, 'kg') : '—'} />
                  <Stat label="Quantidade" value={i.quantity ? formatQty(i.quantity, i.quantityUnit?.toLowerCase() ?? '') : '—'} />
                  <Stat label="Placa" value={i.plate ? <span className="font-mono">{i.plate}</span> : '—'} />
                </div>
                <dl className="space-y-3">
                  <Row label="Chave de acesso" mono>
                    <span className="inline-flex items-center gap-2">
                      {formatKey(i.accessKey)}
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Copiar chave"
                        onClick={() => void navigator.clipboard.writeText(i.accessKey ?? '').then(() => toast.success('Chave copiada'))}
                      >
                        <Copy />
                      </Button>
                    </span>
                  </Row>
                  <Row label="Emissão">{formatDateTime(i.issuedAt)}</Row>
                  <Row label="Emitente">
                    {i.issuer.name ?? '—'} <span className="text-muted">· {formatDoc(i.issuer.document)}</span>
                  </Row>
                  <Row label="Destinatário">
                    {i.recipient.name ?? '—'} <span className="text-muted">· {formatDoc(i.recipient.document)}</span>
                  </Row>
                  <Row label="Produto">{i.productDescription ?? '—'}</Row>
                  <Row label="Protocolo SEFAZ">{i.protocolStatus ? `cStat ${i.protocolStatus}${i.protocolStatus === '100' ? ' · autorizada' : ''}` : 'Sem protocolo no XML'}</Row>
                  <Row label="Ordem">
                    <Link href={`/ordens/${i.order.id}`} className="font-mono text-primary hover:underline">
                      {i.order.number}
                    </Link>
                  </Row>
                  <Row label="Registrada">{formatDateTime(i.createdAt)}</Row>
                </dl>
              </>
            ) : null}
          </div>
        ) : null}
      </Drawer>
      <ReasonDialog
        open={cancelling}
        title="Cancelar NF-e"
        description="A nota deixa de contar para o faturamento da carga. Esta ação fica registrada na auditoria."
        confirmLabel="Cancelar NF-e"
        loading={cancel.isPending}
        onCancel={() => setCancelling(false)}
        onConfirm={(r) => void doCancel(r)}
      />
    </>
  );
}

/** Lista compacta para o drawer da carga (acompanha o processamento pelo worker). */
export function InvoiceList({ loadId }: { loadId: string }) {
  const list = useInvoices({ loadId, pageSize: 50 }, { poll: true });
  const [open, setOpen] = useState<InvoiceDto | null>(null);
  const items = list.data?.items ?? [];

  if (list.isLoading) return <Skeleton className="h-14" />;
  if (!items.length) {
    return <p className="rounded-md bg-surface-2 px-3 py-3 text-sm text-muted">Nenhuma NF-e registrada nesta carga. O XML aparece aqui alguns segundos após o envio.</p>;
  }
  return (
    <>
      <ul className="space-y-2">
        {items.map((i) => (
          <li key={i.id}>
            <button onClick={() => setOpen(i)} className="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left ring-1 ring-border/70 transition hover:bg-primary-soft/30">
              <FileSpreadsheet className="size-4 shrink-0 text-primary" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">
                  {i.number ? `NF-e ${i.number}` : 'XML rejeitado'}
                  <span className="font-normal text-muted"> · {INVOICE_ORIGIN_LABELS[i.origin]}</span>
                </div>
                <div className="truncate text-xs text-muted">
                  {i.rejectReason
                    ? INVOICE_REJECT_LABELS[i.rejectReason]
                    : [i.issuer.name, i.netWeightKg ? formatQty(i.netWeightKg, 'kg') : null, i.divergences.length ? `${i.divergences.length} divergência(s)` : null].filter(Boolean).join(' · ')}
                </div>
              </div>
              <InvoiceStatusBadge status={i.status} />
            </button>
          </li>
        ))}
      </ul>
      <InvoiceDrawer invoice={open ? (items.find((x) => x.id === open.id) ?? open) : null} onClose={() => setOpen(null)} />
    </>
  );
}

const TABS = [
  { key: 'all', label: 'Todas', status: undefined },
  { key: 'VALID', label: 'Válidas', status: ['VALID'] },
  { key: 'DIVERGENT', label: 'Com divergência', status: ['DIVERGENT'] },
  { key: 'REJECTED', label: 'Rejeitadas', status: ['REJECTED'] },
  { key: 'CANCELLED', label: 'Canceladas', status: ['CANCELLED'] },
] as const;

export function InvoicesPage() {
  const [tab, setTab] = useState<(typeof TABS)[number]['key']>('all');
  const [origin, setOrigin] = useState<'FARM' | 'MATRIZ' | 'all'>('all');
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<InvoiceDto | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const current = TABS.find((t) => t.key === tab)!;
  const originFilter = origin === 'all' ? undefined : origin;
  const list = useInvoices({ q: q || undefined, status: current.status ? [...current.status] : undefined, origin: originFilter, pageSize: 200 });
  const all = useInvoices({ origin: originFilter, pageSize: 200 });
  const allItems = all.data?.items ?? [];
  const count = (status?: readonly string[]) => (status ? allItems.filter((i) => status.includes(i.status)).length : (all.data?.total ?? 0));
  const items = list.data?.items ?? [];

  return (
    <div className="mx-auto flex max-w-[1800px] flex-col gap-5 px-4 py-6 sm:px-6 lg:px-8">
      <div className="flex items-center gap-3.5">
        <span className="grid size-11 place-items-center rounded-xl bg-primary-soft text-primary">
          <FileSpreadsheet className="size-5" />
        </span>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Notas Fiscais</h1>
          <p className="text-sm text-muted">NF-e lidas do XML e conferidas com a carga: chave, emitente, placa e peso.</p>
        </div>
      </div>

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-border/70 p-3">
          <div className="-mx-1 flex min-w-0 flex-1 items-center gap-1 overflow-x-auto px-1">
            {TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={cn('relative flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium', tab === t.key ? 'text-primary' : 'text-muted hover:bg-surface-2 hover:text-text')}
              >
                {tab === t.key ? <motion.span layoutId="nfe-tab" className="absolute inset-0 rounded-full bg-primary-soft ring-1 ring-primary/20" /> : null}
                <span className="relative">{t.label}</span>
                <span className="relative rounded-full bg-surface-3 px-1.5 text-[11px] tabular">{count(t.status)}</span>
              </button>
            ))}
          </div>
          <select aria-label="Origem" value={origin} onChange={(e) => setOrigin(e.target.value as typeof origin)} className="h-9 w-full rounded-md bg-surface px-2.5 text-sm ring-1 ring-border sm:w-auto">
            <option value="all">Todas as origens</option>
            <option value="FARM">Emitidas pela Fazenda</option>
            <option value="MATRIZ">Da Matriz</option>
          </select>
          <div className="relative w-full sm:w-72">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Número, chave, emitente ou CNPJ…" className="pl-9" aria-label="Buscar notas" />
          </div>
        </div>

        {list.isLoading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 5 }).map((_, idx) => (
              <Skeleton key={idx} className="h-12" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <EmptyState icon={<FileSpreadsheet />} title="Nenhuma NF-e" description="As notas surgem quando o XML é anexado a uma carga." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-260 text-[13.5px]">
              <thead>
                <tr className="border-b border-border bg-surface-2/80 text-left text-[11.5px] uppercase tracking-wider text-muted">
                  <th className="h-10 px-4">NF-e</th>
                  <th className="px-4">Carga · ordem</th>
                  <th className="px-4">Emitente</th>
                  <th className="px-4 text-right">Peso líquido</th>
                  <th className="px-4 text-right">Valor</th>
                  <th className="px-4">Status</th>
                  <th className="px-4">Registro</th>
                </tr>
              </thead>
              <tbody>
                {items.map((i) => (
                  <tr
                    key={i.id}
                    tabIndex={0}
                    onClick={() => setOpen(i)}
                    onKeyDown={(e) => e.key === 'Enter' && setOpen(i)}
                    className="cursor-pointer border-b border-border/60 outline-none hover:bg-primary-soft/30 focus-visible:bg-primary-soft/40"
                  >
                    <td className="h-14 px-4">
                      <div className="font-medium">{i.number ? `${i.number}${i.series ? `/${i.series}` : ''}` : '—'}</div>
                      <div className="max-w-56 truncate font-mono text-[11px] text-subtle">{i.accessKey ?? (i.rejectReason ? INVOICE_REJECT_LABELS[i.rejectReason] : '')}</div>
                    </td>
                    <td className="px-4">
                      <div className="font-mono text-xs">{i.load.number}</div>
                      <div className="font-mono text-[11px] text-subtle">{i.order.number}</div>
                    </td>
                    <td className="max-w-64 px-4">
                      <div className="truncate">{i.issuer.name ?? '—'}</div>
                      <div className="text-[11px] text-subtle">{INVOICE_ORIGIN_LABELS[i.origin]}</div>
                    </td>
                    <td className="px-4 text-right tabular">{i.netWeightKg ? formatQty(i.netWeightKg, 'kg') : '—'}</td>
                    <td className="px-4 text-right tabular">{i.totalValue ? formatMoney(i.totalValue) : '—'}</td>
                    <td className="px-4">
                      <div className="flex items-center gap-1.5">
                        <InvoiceStatusBadge status={i.status} />
                        {i.divergences.length ? <span className="text-[11px] text-warning">{i.divergences.length}×</span> : null}
                      </div>
                    </td>
                    <td className="px-4 text-xs text-muted">{formatRelative(i.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <InvoiceDrawer invoice={open} onClose={() => setOpen(null)} />
    </div>
  );
}
