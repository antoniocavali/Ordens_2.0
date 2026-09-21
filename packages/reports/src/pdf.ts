import type { ReportColumn, ReportResult } from '@ordens/contracts';
import PDFDocument from 'pdfkit';

const TZ = 'America/Sao_Paulo';
const MARGIN = 28;
const PRIMARY = '#5B3FD1';
const NUMERIC = new Set<ReportColumn['type']>(['number', 'qty', 'money', 'percent']);

const qtyFmt = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 });
const moneyFmt = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dateTimeFmt = new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const brDate = (day: string) => day.slice(0, 10).split('-').reverse().join('/');

export function pdfText(type: ReportColumn['type'], v: string | number | null): string {
  if (v === null || v === '') return '—';
  switch (type) {
    case 'number':
    case 'qty':
      return qtyFmt.format(Number(v));
    case 'money':
      return moneyFmt.format(Number(v));
    case 'percent':
      return `${qtyFmt.format(Number(v))}%`;
    case 'date':
      return brDate(String(v));
    case 'datetime':
      return dateTimeFmt.format(new Date(String(v))).replace(',', '');
    default:
      return String(v);
  }
}

/** Peso da coluna na largura da página: textos longos ganham mais espaço. */
function weights(result: ReportResult): number[] {
  return result.columns.map((c, i) => {
    if (NUMERIC.has(c.type)) return 1;
    if (c.type === 'date') return 1;
    if (c.type === 'datetime') return 1.35;
    const sample = result.rows.slice(0, 200).reduce((m, r) => Math.max(m, String(r[i] ?? '').length), c.label.length);
    return Math.min(3, Math.max(1, sample / 12));
  });
}

/** Tabela em A4 paisagem com cabeçalho repetido por página, zebra e rodapé "Página x de y". */
export function toPdf(result: ReportResult): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: MARGIN, bufferPages: true, info: { Title: result.label, Creator: 'Ordens de Carregamento' } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const width = doc.page.width - MARGIN * 2;
    const cols = result.columns.length;
    const fontSize = cols > 16 ? 6 : cols > 11 ? 7 : 8;
    const rowH = fontSize + 7;
    const pad = 3;
    const w = weights(result);
    const totalW = w.reduce((a, b) => a + b, 0);
    const colW = w.map((x) => (x / totalW) * width);
    const bottom = () => doc.page.height - MARGIN - 18;

    // Título
    doc.font('Helvetica-Bold').fontSize(15).fillColor('#1d1b26').text(result.label, MARGIN, MARGIN);
    doc
      .font('Helvetica')
      .fontSize(9)
      .fillColor('#6b6780')
      .text(
        `Período: ${brDate(result.from)} a ${brDate(result.to)}   ·   Gerado em ${pdfText('datetime', result.generatedAt)}   ·   ${result.rows.length.toLocaleString('pt-BR')} linhas`,
      );
    if (result.truncated) {
      doc
        .fillColor('#b45309')
        .text(`Mostrando ${result.rows.length.toLocaleString('pt-BR')} de ${result.total.toLocaleString('pt-BR')} linhas. Exporte em Excel ou CSV para ter todas.`);
    }
    let y = doc.y + 8;

    const cellText = (text: string, x: number, i: number, top: number, bold = false) => {
      const numeric = NUMERIC.has(result.columns[i]!.type);
      doc
        .font(bold ? 'Helvetica-Bold' : 'Helvetica')
        .fontSize(fontSize)
        .text(text, x + pad, top + (rowH - fontSize) / 2 - 0.5, { width: colW[i]! - pad * 2, height: fontSize + 2, ellipsis: true, lineBreak: false, align: numeric && !bold ? 'right' : 'left' });
    };

    const drawHeader = () => {
      doc.rect(MARGIN, y, width, rowH + 2).fill(PRIMARY);
      doc.fillColor('#ffffff');
      let x = MARGIN;
      result.columns.forEach((c, i) => {
        cellText(c.label, x, i, y + 1, true);
        x += colW[i]!;
      });
      y += rowH + 2;
    };

    drawHeader();
    if (!result.rows.length) {
      doc.font('Helvetica').fontSize(10).fillColor('#6b6780').text('Sem dados no período.', MARGIN, y + 10);
    }
    result.rows.forEach((row, r) => {
      if (y + rowH > bottom()) {
        doc.addPage();
        y = MARGIN;
        drawHeader();
      }
      if (r % 2 === 1) doc.rect(MARGIN, y, width, rowH).fill('#f4f2fb');
      doc.fillColor('#1d1b26');
      let x = MARGIN;
      row.forEach((v, i) => {
        cellText(pdfText(result.columns[i]!.type, v), x, i, y);
        x += colW[i]!;
      });
      y += rowH;
    });

    // Rodapé em todas as páginas (margem inferior zerada para não criar página nova).
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      const saved = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      const footerY = doc.page.height - MARGIN;
      doc.font('Helvetica').fontSize(7).fillColor('#8a86a0');
      doc.text(`Ordens de Carregamento · ${result.label}`, MARGIN, footerY, { width: width / 2, lineBreak: false });
      doc.text(`Página ${i + 1} de ${range.count}`, MARGIN + width / 2, footerY, { width: width / 2, align: 'right', lineBreak: false });
      doc.page.margins.bottom = saved;
    }
    doc.end();
  });
}
