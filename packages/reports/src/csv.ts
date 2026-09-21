import type { ReportColumn } from '@ordens/contracts';

const TZ = 'America/Sao_Paulo';
const dateTime = new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

/** Valor da célula no formato que o Excel em pt-BR abre sem ajuste (decimal com vírgula, datas dd/mm/aaaa). */
export function formatCell(type: ReportColumn['type'], value: string | number | null): string {
  if (value === null || value === '') return '';
  switch (type) {
    case 'qty':
    case 'money':
    case 'percent':
    case 'number':
      return String(value).replace('.', ',');
    case 'date': {
      const [y, m, d] = String(value).slice(0, 10).split('-');
      return `${d}/${m}/${y}`;
    }
    case 'datetime':
      return dateTime.format(new Date(String(value))).replace(',', '');
    default:
      return String(value);
  }
}

const escape = (v: string) => (/[;"\r\n]/.test(v) || /^[=+\-@]/.test(v) ? `"${(/^[=+\-@]/.test(v) ? `'${v}` : v).replace(/"/g, '""')}"` : v);

/**
 * CSV com BOM UTF-8, separador ";" e CRLF. Textos que começam com = + - @ recebem apóstrofo
 * para não virarem fórmula na planilha (CSV injection).
 */
export function toCsv(columns: ReportColumn[], rows: (string | number | null)[][]): string {
  const lines = [columns.map((c) => escape(c.label)).join(';')];
  for (const row of rows) {
    lines.push(
      row
        .map((v, i) => {
          const col = columns[i]!;
          const text = formatCell(col.type, v);
          // Números negativos são dados legítimos, não fórmulas.
          return col.type === 'text' || col.type === 'date' || col.type === 'datetime' ? escape(text) : text;
        })
        .join(';'),
    );
  }
  return `${String.fromCharCode(0xfeff)}${lines.join('\r\n')}\r\n`;
}
