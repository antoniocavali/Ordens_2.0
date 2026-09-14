import { z } from 'zod';

/** Relatórios exportáveis (Q38). Recorte de linhas sempre pelo RLS da organização ativa. */
export const REPORT_KINDS = ['orders', 'loads', 'releases', 'carriers', 'occurrences'] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];

export const REPORT_INFO: Record<ReportKind, { label: string; description: string }> = {
  orders: { label: 'Posição das ordens', description: 'Quantidades por etapa, saldo e valor das ordens publicadas no período.' },
  loads: { label: 'Cargas', description: 'Cargas do período com transportadora, placas, pesos e recebimento.' },
  releases: { label: 'Liberações', description: 'Liberações criadas no período, com validade e cancelamentos.' },
  carriers: { label: 'Desempenho de transportadoras', description: 'Cargas, volume líquido e divergências de peso por transportadora (Q24).' },
  occurrences: { label: 'Ocorrências', description: 'Ocorrências abertas no período, com responsável, prazo e resolução.' },
};

export type ReportColumnType = 'text' | 'number' | 'qty' | 'money' | 'percent' | 'date' | 'datetime';

export interface ReportColumn {
  key: string;
  label: string;
  type: ReportColumnType;
}

export const REPORT_PREVIEW_LIMIT = 200;
export const REPORT_EXPORT_LIMIT = 50_000;
/** PDF é para leitura/impressão: tabela limitada para manter o arquivo utilizável. */
export const REPORT_PDF_LIMIT = 5_000;

export const REPORT_FORMATS = ['csv', 'xlsx', 'pdf'] as const;
export type ReportFormat = (typeof REPORT_FORMATS)[number];
export const REPORT_FORMAT_LABELS: Record<ReportFormat, string> = { csv: 'CSV', xlsx: 'Excel', pdf: 'PDF' };
export const reportFormatSchema = z.enum(REPORT_FORMATS).default('csv');
export const REPORT_MAX_DAYS = 366;

const dateOnly = z.iso.date();

export const reportQuerySchema = z
  .object({
    from: dateOnly.optional(),
    to: dateOnly.optional(),
    commodityId: z.uuid().optional(),
  })
  .refine((q) => !q.from || !q.to || q.from <= q.to, { message: 'A data inicial deve ser anterior à final', path: ['from'] });
export type ReportQuery = z.infer<typeof reportQuerySchema>;

export const reportKindSchema = z.enum(REPORT_KINDS);

/** Linhas alinhadas às colunas; decimais como string, datas ISO (date = AAAA-MM-DD). */
export interface ReportResult {
  kind: ReportKind;
  label: string;
  from: string;
  to: string;
  columns: ReportColumn[];
  rows: (string | number | null)[][];
  total: number;
  truncated: boolean;
  generatedAt: string;
}
