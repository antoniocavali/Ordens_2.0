import type { ReportColumn, ReportResult } from '@ordens/contracts';
import ExcelJS from 'exceljs';

const TZ = 'America/Sao_Paulo';

const NUM_FMT: Partial<Record<ReportColumn['type'], string>> = {
  number: '#,##0',
  qty: '#,##0.000',
  money: '#,##0.00',
  percent: '0.0%',
  date: 'dd/mm/yyyy',
  datetime: 'dd/mm/yyyy hh:mm',
};

/** Excel não tem fuso: grava o horário de parede de São Paulo como se fosse UTC. */
function wallClock(iso: string): Date {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
      .formatToParts(new Date(iso))
      .map((p) => [p.type, p.value]),
  );
  return new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second)));
}

/** Valor tipado da célula: números e datas de verdade (somáveis e filtráveis no Excel). Texto nunca vira fórmula. */
export function xlsxValue(type: ReportColumn['type'], v: string | number | null): string | number | Date | null {
  if (v === null || v === '') return null;
  switch (type) {
    case 'number':
    case 'qty':
    case 'money':
      return Number(v);
    case 'percent':
      return Number(v) / 100;
    case 'date':
      return new Date(`${String(v).slice(0, 10)}T00:00:00Z`);
    case 'datetime':
      return wallClock(String(v));
    default:
      return String(v);
  }
}

const brDate = (day: string) => day.split('-').reverse().join('/');

export async function toXlsx(result: ReportResult): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Ordens de Carregamento';
  wb.created = new Date(result.generatedAt);

  const ws = wb.addWorksheet(result.label.slice(0, 31), { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = result.columns.map((c) => ({
    header: c.label,
    key: c.key,
    width: Math.min(45, Math.max(c.type === 'datetime' ? 17 : 12, c.label.length + 3)),
    style: NUM_FMT[c.type] ? { numFmt: NUM_FMT[c.type] } : {},
  }));
  for (const row of result.rows) ws.addRow(row.map((v, i) => xlsxValue(result.columns[i]!.type, v)));

  // Largura pelo conteúdo de texto (amostra das primeiras linhas).
  result.columns.forEach((c, i) => {
    if (c.type !== 'text') return;
    const longest = result.rows.slice(0, 500).reduce((m, r) => Math.max(m, String(r[i] ?? '').length), c.label.length);
    ws.getColumn(i + 1).width = Math.min(45, Math.max(12, longest + 2));
  });

  const header = ws.getRow(1);
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF5B3FD1' } };
  header.alignment = { vertical: 'middle' };
  header.height = 22;
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: result.columns.length } };

  const info = wb.addWorksheet('Informações');
  info.columns = [{ width: 22 }, { width: 60 }];
  info.addRows([
    ['Relatório', result.label],
    ['Período', `${brDate(result.from)} a ${brDate(result.to)}`],
    ['Gerado em', wallClock(result.generatedAt)],
    ['Linhas', result.rows.length],
    ...(result.truncated ? [['Atenção', `Exportadas ${result.rows.length} de ${result.total} linhas. Reduza o período para ver tudo.`]] : []),
  ]);
  info.getCell('B3').numFmt = 'dd/mm/yyyy hh:mm';
  info.getColumn(1).font = { bold: true };

  return Buffer.from(await wb.xlsx.writeBuffer());
}
