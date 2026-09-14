'use client';

import {
  REPORT_EXPORT_LIMIT,
  REPORT_FORMAT_LABELS,
  REPORT_FORMATS,
  REPORT_INFO,
  REPORT_KINDS,
  REPORT_PDF_LIMIT,
  type ReportColumn,
  type ReportFormat,
  type ReportKind,
  type ReportResult,
} from '@ordens/contracts';
import { Button, Card, cn, EmptyState, Input, Skeleton } from '@ordens/ui';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { AlertTriangle, BarChart3, ClipboardList, Download, FileSpreadsheet, FileText, PackageCheck, ShieldOff, Truck, Users } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { ApiRequestError, get } from '@/lib/api';
import { formatDate, formatDateTime } from '@/lib/format';
import { useCan, useMe } from '@/lib/session';

const ICONS: Record<ReportKind, ReactNode> = {
  orders: <ClipboardList className="size-5" />,
  loads: <Truck className="size-5" />,
  releases: <PackageCheck className="size-5" />,
  carriers: <Users className="size-5" />,
  occurrences: <AlertTriangle className="size-5" />,
};

const localDay = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(d);
const daysAgo = (n: number) => localDay(new Date(Date.now() - n * 86_400_000));
const PRESETS = [
  { label: '7 dias', days: 7 },
  { label: '30 dias', days: 30 },
  { label: '90 dias', days: 90 },
];

const numberFmt = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 });
const moneyFmt = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function cell(type: ReportColumn['type'], v: string | number | null): string {
  if (v === null || v === '') return '—';
  switch (type) {
    case 'qty':
    case 'number':
      return numberFmt.format(Number(v));
    case 'money':
      return moneyFmt.format(Number(v));
    case 'percent':
      return `${numberFmt.format(Number(v))}%`;
    case 'date':
      return formatDate(String(v));
    case 'datetime':
      return formatDateTime(String(v));
    default:
      return String(v);
  }
}

const FORMAT_ICONS: Record<ReportFormat, ReactNode> = {
  csv: <Download />,
  xlsx: <FileSpreadsheet />,
  pdf: <FileText />,
};

/** Baixa o arquivo pela mesma origem (cookie de sessão); a API audita a exportação. */
async function downloadReport(kind: ReportKind, from: string, to: string, format: ReportFormat) {
  const res = await fetch(`/api/reports/${kind}/export?${new URLSearchParams({ from, to, format })}`, { credentials: 'same-origin' });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
    throw new ApiRequestError(res.status, body?.error?.code ?? 'UNKNOWN', body?.error?.message ?? 'Não foi possível exportar.');
  }
  const filename = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? `relatorio-${kind}.${format}`;
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return { filename, rows: Number(res.headers.get('x-report-rows') ?? 0), truncated: res.headers.get('x-report-truncated') === 'true' };
}

export function ReportsPage() {
  const can = useCan();
  const { data: me } = useMe();
  const allowed = can('report.export');
  const [kind, setKind] = useState<ReportKind>('orders');
  const [from, setFrom] = useState(() => daysAgo(29));
  const [to, setTo] = useState(() => localDay(new Date()));
  const [exporting, setExporting] = useState<ReportFormat | null>(null);

  const validRange = Boolean(from && to && from <= to);
  const report = useQuery({
    queryKey: ['reports', kind, from, to],
    queryFn: ({ signal }) => get<ReportResult>(`/reports/${kind}`, { from, to }, signal),
    enabled: allowed && validRange,
    placeholderData: keepPreviousData,
  });

  if (me && !allowed) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16">
        <EmptyState icon={<ShieldOff />} title="Sem acesso a relatórios" description="A exportação de relatórios é liberada para gestores e administradores da Matriz." />
      </div>
    );
  }

  const data = report.data?.kind === kind ? report.data : undefined;
  const error = report.error instanceof ApiRequestError ? (report.error.fieldErrors.from?.[0] ?? report.error.message) : report.error ? 'Não foi possível gerar o relatório.' : null;

  const onExport = async (format: ReportFormat) => {
    setExporting(format);
    try {
      const r = await downloadReport(kind, from, to, format);
      const limit = format === 'pdf' ? REPORT_PDF_LIMIT : REPORT_EXPORT_LIMIT;
      toast.success(`Relatório exportado em ${REPORT_FORMAT_LABELS[format]}`, {
        description: r.truncated
          ? `${r.rows.toLocaleString('pt-BR')} linhas (limite de ${limit.toLocaleString('pt-BR')}${format === 'pdf' ? ' no PDF; use Excel ou CSV para tudo' : '; reduza o período para ver tudo'}).`
          : `${r.filename} · ${r.rows.toLocaleString('pt-BR')} linhas`,
      });
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : 'Não foi possível exportar.');
    } finally {
      setExporting(null);
    }
  };

  return (
    <div className="mx-auto flex max-w-[1800px] flex-col gap-5 px-4 py-6 sm:px-6 lg:px-8">
      <div className="flex items-center gap-3.5">
        <span className="grid size-11 place-items-center rounded-xl bg-primary-soft text-primary">
          <BarChart3 className="size-5" />
        </span>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Relatórios</h1>
          <p className="text-sm text-muted">Confira a prévia e exporte em Excel, PDF ou CSV. Toda exportação fica registrada na auditoria.</p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5" role="radiogroup" aria-label="Relatório">
        {REPORT_KINDS.map((k) => (
          <button
            key={k}
            role="radio"
            aria-checked={kind === k}
            onClick={() => setKind(k)}
            className={cn(
              'flex items-start gap-3 rounded-lg bg-surface p-3.5 text-left shadow-sm ring-1 ring-border/60 transition hover:-translate-y-px hover:shadow-md',
              kind === k && 'bg-primary-soft/40 ring-2 ring-primary/50',
            )}
          >
            <span className={cn('grid size-9 shrink-0 place-items-center rounded-lg', kind === k ? 'bg-primary text-white' : 'bg-surface-2 text-muted')}>{ICONS[k]}</span>
            <span>
              <span className="block text-sm font-semibold">{REPORT_INFO[k].label}</span>
              <span className="mt-0.5 block text-xs text-muted">{REPORT_INFO[k].description}</span>
            </span>
          </button>
        ))}
      </div>

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-end gap-2 border-b border-border/70 p-3">
          <label className="flex items-center gap-1.5 text-xs text-muted">
            De
            <Input type="date" aria-label="Data inicial" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="w-40" />
          </label>
          <label className="flex items-center gap-1.5 text-xs text-muted">
            até
            <Input type="date" aria-label="Data final" value={to} min={from} onChange={(e) => setTo(e.target.value)} className="w-40" />
          </label>
          <div className="flex gap-1">
            {PRESETS.map((p) => (
              <Button
                key={p.days}
                variant="ghost"
                size="sm"
                onClick={() => {
                  setFrom(daysAgo(p.days - 1));
                  setTo(localDay(new Date()));
                }}
              >
                {p.label}
              </Button>
            ))}
          </div>
          <span className="ml-auto self-center text-xs text-subtle tabular" aria-live="polite">
            {report.isFetching ? 'Gerando…' : data ? (data.truncated ? `Prévia: ${data.rows.length} de ${data.total.toLocaleString('pt-BR')} linhas` : `${data.total.toLocaleString('pt-BR')} linhas`) : null}
          </span>
          <div className="flex items-center gap-1 rounded-lg bg-surface-2 p-1" role="group" aria-label="Exportar relatório">
            <span className="px-2 text-xs font-medium text-muted">Exportar</span>
            {REPORT_FORMATS.map((f) => (
              <Button
                key={f}
                size="sm"
                variant={f === 'xlsx' ? 'primary' : 'ghost'}
                aria-label={`Exportar ${REPORT_FORMAT_LABELS[f]}`}
                onClick={() => onExport(f)}
                loading={exporting === f}
                disabled={!validRange || !data?.total || (exporting !== null && exporting !== f)}
              >
                {FORMAT_ICONS[f]} {REPORT_FORMAT_LABELS[f]}
              </Button>
            ))}
          </div>
        </div>

        {error ? (
          <EmptyState icon={<AlertTriangle />} title="Relatório indisponível" description={error} />
        ) : !data ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-9" />
            ))}
          </div>
        ) : !data.rows.length ? (
          <EmptyState icon={ICONS[kind]} title="Sem dados no período" description="Ajuste as datas para ampliar o período." />
        ) : (
          <div className="max-h-[65vh] overflow-auto">
            <table className={cn('w-full border-separate border-spacing-0 text-[13px]', report.isPlaceholderData && 'opacity-60')} aria-label={data.label}>
              <thead className="sticky top-0 z-10">
                <tr className="text-left text-[11px] font-semibold uppercase tracking-wider text-muted">
                  {data.columns.map((c) => (
                    <th key={c.key} className={cn('h-10 whitespace-nowrap border-b border-border bg-surface-2 px-3', ['qty', 'money', 'number', 'percent'].includes(c.type) && 'text-right')}>
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row, i) => (
                  <tr key={i} className="hover:bg-primary-soft/20">
                    {row.map((v, j) => {
                      const col = data.columns[j]!;
                      const numeric = ['qty', 'money', 'number', 'percent'].includes(col.type);
                      return (
                        <td key={col.key} className={cn('h-9 max-w-72 truncate whitespace-nowrap border-b border-border/60 px-3', numeric && 'text-right tabular', j === 0 && 'font-medium')}>
                          {cell(col.type, v)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data?.truncated ? (
          <div className="border-t border-border/70 px-4 py-2 text-xs text-muted">
            A prévia mostra as {data.rows.length} primeiras linhas. Excel e CSV trazem até {REPORT_EXPORT_LIMIT.toLocaleString('pt-BR')} linhas; o PDF, até {REPORT_PDF_LIMIT.toLocaleString('pt-BR')}.
          </div>
        ) : null}
      </Card>
    </div>
  );
}
