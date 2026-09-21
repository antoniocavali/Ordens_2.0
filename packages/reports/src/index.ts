/**
 * Geração de relatórios compartilhada pela API (prévia e exportação imediata) e pelo worker
 * (exportações em segundo plano): definições SQL, execução com o recorte do perfil e os formatos.
 */
import type { ReportFormat, ReportResult } from '@ordens/contracts';
import { toCsv } from './csv.js';
import { toPdf } from './pdf.js';
import { toXlsx } from './xlsx.js';

export { formatCell, toCsv } from './csv.js';
export { REPORTS, TZ, type ReportDefinition, type ReportParams } from './definitions.js';
export { pdfText, toPdf } from './pdf.js';
export { ReportError, reportPeriod, runReport } from './run.js';
export { toXlsx, xlsxValue } from './xlsx.js';

export const REPORT_CONTENT_TYPES: Record<ReportFormat, string> = {
  csv: 'text/csv; charset=utf-8',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pdf: 'application/pdf',
};

/** Arquivo do relatório no formato pedido, com nome padronizado. */
export async function renderReport(result: ReportResult, format: ReportFormat): Promise<{ body: string | Buffer; filename: string; contentType: string }> {
  const body = format === 'xlsx' ? await toXlsx(result) : format === 'pdf' ? await toPdf(result) : toCsv(result.columns, result.rows);
  return { body, filename: `relatorio-${result.kind}-${result.from}-a-${result.to}.${format}`, contentType: REPORT_CONTENT_TYPES[format] };
}
