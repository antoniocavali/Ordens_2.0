import { describe, expect, it } from 'vitest';
import { evaluateFiscalDocuments } from './schemas/logistics.js';

const at = (min: number) => new Date(Date.UTC(2026, 8, 15, 10, min));
const pdf = (id: string, status: string, min: number) => ({ id, kind: 'PDF', status, createdAt: at(min) });
const xml = (id: string, status: string, min: number) => ({ id, kind: 'NFE_XML', status, createdAt: at(min) });

describe('documentação fiscal da carga (Q41)', () => {
  it('libera com pesagem, PDF disponível e XML com NF-e válida ou com divergência', () => {
    for (const status of ['VALID', 'DIVERGENT']) {
      const r = evaluateFiscalDocuments({ weighed: true, uploads: [pdf('p', 'AVAILABLE', 1), xml('x', 'AVAILABLE', 2)], invoices: [{ fileUploadId: 'x', status }] });
      expect(r).toMatchObject({ ready: true, pdf: 'OK', xml: 'OK', issues: [] });
    }
  });

  it('bloqueia sem pesagem, sem PDF ou sem XML', () => {
    const r = evaluateFiscalDocuments({ weighed: false, uploads: [], invoices: [] });
    expect(r).toMatchObject({ ready: false, pdf: 'MISSING', xml: 'MISSING' });
    expect(r.issues).toHaveLength(3);
    expect(evaluateFiscalDocuments({ weighed: true, uploads: [xml('x', 'AVAILABLE', 1)], invoices: [{ fileUploadId: 'x', status: 'VALID' }] }).ready).toBe(false);
  });

  it('XML rejeitado, cancelado, pendente ou ainda sem NF-e processada bloqueia', () => {
    const base = [pdf('p', 'AVAILABLE', 1)];
    expect(evaluateFiscalDocuments({ weighed: true, uploads: [...base, xml('x', 'AVAILABLE', 2)], invoices: [{ fileUploadId: 'x', status: 'REJECTED' }] }).xml).toBe('REJECTED');
    expect(evaluateFiscalDocuments({ weighed: true, uploads: [...base, xml('x', 'AVAILABLE', 2)], invoices: [{ fileUploadId: 'x', status: 'CANCELLED' }] }).xml).toBe('REJECTED');
    expect(evaluateFiscalDocuments({ weighed: true, uploads: [...base, xml('x', 'AVAILABLE', 2)], invoices: [] }).xml).toBe('PROCESSING');
    expect(evaluateFiscalDocuments({ weighed: true, uploads: [...base, xml('x', 'PROCESSING', 2)], invoices: [] }).xml).toBe('PENDING');
    expect(evaluateFiscalDocuments({ weighed: true, uploads: [...base, xml('x', 'REJECTED', 2)], invoices: [] }).xml).toBe('REJECTED');
  });

  it('arquivo infectado ou pendente bloqueia, mesmo havendo outro válido', () => {
    const validXml = [xml('x', 'AVAILABLE', 1)];
    const inv = [{ fileUploadId: 'x', status: 'VALID' }];
    expect(evaluateFiscalDocuments({ weighed: true, uploads: [pdf('p1', 'AVAILABLE', 1), pdf('p2', 'INFECTED', 5), ...validXml], invoices: inv })).toMatchObject({ pdf: 'INFECTED', ready: false });
    expect(evaluateFiscalDocuments({ weighed: true, uploads: [pdf('p1', 'AVAILABLE', 1), pdf('p2', 'UPLOADING', 5), ...validXml], invoices: inv })).toMatchObject({ pdf: 'PENDING', ready: false });
  });

  it('novo envio válido supera arquivo rejeitado anterior', () => {
    const r = evaluateFiscalDocuments({
      weighed: true,
      uploads: [pdf('p0', 'REJECTED', 0), pdf('p1', 'AVAILABLE', 3), xml('x0', 'AVAILABLE', 1), xml('x1', 'AVAILABLE', 4)],
      invoices: [
        { fileUploadId: 'x0', status: 'REJECTED' },
        { fileUploadId: 'x1', status: 'VALID' },
      ],
    });
    expect(r.ready).toBe(true);
  });
});
