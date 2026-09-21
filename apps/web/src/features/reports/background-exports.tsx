'use client';

import {
  REPORT_FORMAT_LABELS,
  REPORT_FORMATS,
  REPORT_INFO,
  REPORT_JOB_LIMITS,
  REPORT_JOB_RETENTION_DAYS,
  REPORT_JOB_STATUS_LABELS,
  type ReportFormat,
  type ReportJobDto,
  type ReportKind,
} from '@ordens/contracts';
import { Badge, Button, Card, cn } from '@ordens/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Clock, Download, Hourglass } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { ApiRequestError, get, post } from '@/lib/api';
import { formatDate, formatDateTime } from '@/lib/format';

const JOBS_KEY = ['reports', 'jobs'];

const TONE: Record<ReportJobDto['status'], 'neutral' | 'info' | 'success' | 'danger' | 'warning'> = {
  PENDING: 'neutral',
  RUNNING: 'info',
  DONE: 'success',
  FAILED: 'danger',
  EXPIRED: 'warning',
};

const bytes = (n: number | null) => (n === null ? '' : n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1).replace('.', ',')} MB`);

/**
 * Exportações em segundo plano: para períodos grandes, o arquivo é gerado pelo worker e fica disponível
 * por alguns dias. A lista mostra só as exportações de quem consulta.
 */
export function BackgroundExports({ kind, from, to, disabled }: { kind: ReportKind; from: string; to: string; disabled: boolean }) {
  const qc = useQueryClient();
  const [format, setFormat] = useState<ReportFormat>('xlsx');
  const jobs = useQuery({
    queryKey: JOBS_KEY,
    queryFn: ({ signal }) => get<ReportJobDto[]>('/reports/jobs', undefined, signal),
    // Enquanto houver exportação na fila ou em geração, atualiza sozinho.
    refetchInterval: (q) => (q.state.data?.some((j) => j.status === 'PENDING' || j.status === 'RUNNING') ? 3000 : false),
  });

  const request = useMutation({
    mutationFn: () => post<ReportJobDto>(`/reports/${kind}/jobs`, { from, to, format }),
    onSuccess: (job) => {
      qc.setQueryData<ReportJobDto[]>(JOBS_KEY, (list) => [job, ...(list ?? [])]);
      toast.success('Exportação na fila', { description: 'Você recebe um aviso quando o arquivo estiver pronto.' });
    },
    onError: (err) => toast.error(err instanceof ApiRequestError ? err.message : 'Não foi possível pedir a exportação.'),
  });

  const download = async (job: ReportJobDto) => {
    try {
      const { url } = await get<{ url: string }>(`/reports/jobs/${job.id}/download`);
      window.location.assign(url);
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : 'Não foi possível baixar o arquivo.');
      void qc.invalidateQueries({ queryKey: JOBS_KEY });
    }
  };

  const list = jobs.data ?? [];

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b border-border/70 p-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold">Exportar em segundo plano</h2>
          <p className="text-xs text-muted">
            Para períodos grandes: até {REPORT_JOB_LIMITS.csv.toLocaleString('pt-BR')} linhas em CSV, {REPORT_JOB_LIMITS.xlsx.toLocaleString('pt-BR')} em Excel e{' '}
            {REPORT_JOB_LIMITS.pdf.toLocaleString('pt-BR')} em PDF. O arquivo fica disponível por {REPORT_JOB_RETENTION_DAYS} dias.
          </p>
        </div>
        <div className="flex items-center gap-1 rounded-lg bg-surface-2 p-1" role="radiogroup" aria-label="Formato da exportação em segundo plano">
          {REPORT_FORMATS.map((f) => (
            <button
              key={f}
              type="button"
              role="radio"
              aria-checked={format === f}
              onClick={() => setFormat(f)}
              className={cn('h-7 rounded-md px-2.5 text-xs font-medium', format === f ? 'bg-surface text-text shadow-sm' : 'text-muted hover:text-text')}
            >
              {REPORT_FORMAT_LABELS[f]}
            </button>
          ))}
        </div>
        <Button size="sm" variant="outline" onClick={() => request.mutate()} loading={request.isPending} disabled={disabled}>
          <Hourglass /> Gerar em segundo plano
        </Button>
      </div>

      {list.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-subtle">{jobs.isLoading ? 'Carregando…' : 'Nenhuma exportação em segundo plano ainda.'}</p>
      ) : (
        <ul className="divide-y divide-border/60" aria-label="Exportações recentes">
          {list.map((j) => (
            <li key={j.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">
                  {REPORT_INFO[j.kind]?.label ?? j.label} · {REPORT_FORMAT_LABELS[j.format]}
                </span>
                <span className="block text-xs text-subtle">
                  {j.from && j.to ? `${formatDate(j.from)} a ${formatDate(j.to)} · ` : ''}pedido em {formatDateTime(j.createdAt)}
                  {j.status === 'DONE' && j.rows !== null ? ` · ${j.rows.toLocaleString('pt-BR')} linhas${j.truncated ? ' (limite atingido)' : ''} · ${bytes(j.sizeBytes)}` : ''}
                  {j.status === 'FAILED' && j.error ? ` · ${j.error}` : ''}
                </span>
              </span>
              <Badge tone={TONE[j.status]} size="sm">
                {j.status === 'PENDING' || j.status === 'RUNNING' ? <Clock /> : null}
                {REPORT_JOB_STATUS_LABELS[j.status]}
              </Badge>
              {j.status === 'DONE' ? (
                <Button size="sm" variant="ghost" onClick={() => void download(j)} aria-label={`Baixar ${REPORT_INFO[j.kind]?.label ?? j.label} em ${REPORT_FORMAT_LABELS[j.format]}`}>
                  <Download /> Baixar
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
