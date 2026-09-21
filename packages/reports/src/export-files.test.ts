import type { ReportResult } from '@ordens/contracts';
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { pdfText, toPdf } from './pdf.js';
import { toXlsx, xlsxValue } from './xlsx.js';

const result = (rows: number): ReportResult => ({
  kind: 'loads',
  label: 'Cargas',
  from: '2026-09-01',
  to: '2026-09-14',
  columns: [
    { key: 'number', label: 'Carga', type: 'text' },
    { key: 'qty', label: 'Previsto', type: 'qty' },
    { key: 'pct', label: '% divergência', type: 'percent' },
    { key: 'day', label: 'Data', type: 'date' },
    { key: 'at', label: 'Carregada em', type: 'datetime' },
  ],
  rows: Array.from({ length: rows }, (_, i) => [i === 0 ? '=SOMA(A1)' : `CG-${i} Fazenda São João`, '1234.5000', 12.5, '2026-09-14', '2026-09-14T03:30:00.000Z']),
  total: rows,
  truncated: false,
  generatedAt: '2026-09-14T15:00:00.000Z',
});

describe('exportação Excel', () => {
  it('grava números e datas tipados, cabeçalho com filtro e aba de informações', async () => {
    const buffer = await toXlsx(result(3));
    expect(buffer.subarray(0, 2).toString()).toBe('PK');

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
    const ws = wb.getWorksheet('Cargas')!;
    expect(ws.getCell('A1').value).toBe('Carga');
    expect(ws.autoFilter).toBeTruthy();
    // Texto que parece fórmula continua texto.
    expect(ws.getCell('A2').value).toBe('=SOMA(A1)');
    expect(ws.getCell('A2').formula).toBeUndefined();
    expect(ws.getCell('B2').value).toBe(1234.5);
    expect(ws.getCell('C2').value).toBeCloseTo(0.125);
    expect(ws.getCell('D2').value).toBeInstanceOf(Date);
    expect(wb.getWorksheet('Informações')!.getCell('B2').value).toBe('01/09/2026 a 14/09/2026');
  });

  it('converte data e hora para o horário de São Paulo', () => {
    expect((xlsxValue('datetime', '2026-09-14T03:30:00.000Z') as Date).toISOString()).toBe('2026-09-14T00:30:00.000Z');
    expect(xlsxValue('qty', null)).toBeNull();
  });
});

describe('exportação PDF', () => {
  it('gera PDF com várias páginas quando a tabela não cabe em uma', async () => {
    const buffer = await toPdf(result(300));
    expect(buffer.subarray(0, 4).toString()).toBe('%PDF');
    const pages = buffer.toString('latin1').match(/\/Type \/Page\b/g)?.length ?? 0;
    expect(pages).toBeGreaterThan(1);
  });

  it('formata valores em pt-BR', () => {
    expect(pdfText('qty', '1234.5000')).toBe('1.234,5');
    expect(pdfText('money', '10')).toBe('10,00');
    expect(pdfText('date', '2026-09-14')).toBe('14/09/2026');
    expect(pdfText('text', null)).toBe('—');
  });
});
