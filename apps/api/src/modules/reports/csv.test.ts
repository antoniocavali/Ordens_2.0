import type { ReportColumn } from '@ordens/contracts';
import { describe, expect, it } from 'vitest';
import { formatCell, toCsv } from './csv.js';

const columns: ReportColumn[] = [
  { key: 'name', label: 'Nome', type: 'text' },
  { key: 'qty', label: 'Quantidade', type: 'qty' },
  { key: 'day', label: 'Data', type: 'date' },
];

describe('CSV de relatórios', () => {
  it('usa BOM, ponto e vírgula, CRLF e decimal com vírgula', () => {
    const csv = toCsv(columns, [['Fazenda A', '1234.5000', '2026-09-14']]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.slice(1)).toBe('Nome;Quantidade;Data\r\nFazenda A;1234,5000;14/09/2026\r\n');
  });

  it('escapa separador, aspas e quebra de linha', () => {
    const csv = toCsv(columns, [['Silva; "Grãos"\nLtda', null, null]]);
    expect(csv.split('\r\n')[1]).toBe('"Silva; ""Grãos""\nLtda";;');
  });

  it('neutraliza fórmulas em texto, mas mantém números negativos', () => {
    const csv = toCsv(columns, [['=HYPERLINK("x")', '-10.5', null]]);
    expect(csv.split('\r\n')[1]).toBe(`"'=HYPERLINK(""x"")";-10,5;`);
  });

  it('formata data e hora no fuso de São Paulo', () => {
    expect(formatCell('datetime', '2026-09-14T03:30:00.000Z')).toBe('14/09/2026 00:30');
    expect(formatCell('percent', 12.5)).toBe('12,5');
  });
});
