import { describe, expect, it } from 'vitest';
import { Prisma } from '@ordens/db';
import { evaluateDivergences } from '../jobs/invoice-processing.js';
import { isValidAccessKey, NfeParseError, parseNfe, sumDecimal } from './parse-nfe.js';

/** Completa 43 dígitos com o DV (módulo 11). */
function withCheckDigit(base: string) {
  let weight = 2;
  let sum = 0;
  for (let i = base.length - 1; i >= 0; i--) {
    sum += Number(base[i]) * weight;
    weight = weight === 9 ? 2 : weight + 1;
  }
  const rest = sum % 11;
  return `${base}${rest < 2 ? 0 : 11 - rest}`;
}

const KEY = withCheckDigit('51' + '2609' + '12345678000190' + '55' + '001' + '000001234' + '1' + '12345678');

const nfe = (opts: { key?: string; protocolKey?: string; cStat?: string | null; units?: [string, string]; wrap?: boolean } = {}) => {
  const key = opts.key ?? KEY;
  const [u1, u2] = opts.units ?? ['KG', 'kg'];
  const inner = `<NFe><infNFe Id="NFe${key}" versao="4.00">
    <ide><serie>1</serie><nNF>1234</nNF><dhEmi>2026-09-10T08:30:00-03:00</dhEmi></ide>
    <emit><CNPJ>12.345.678/0001-90</CNPJ><xNome>Produtor Teste</xNome></emit>
    <dest><CNPJ>98765432000110</CNPJ><xNome>Grão Forte</xNome></dest>
    <det nItem="1"><prod><xProd>MILHO EM GRAOS</xProd><uCom>${u1}</uCom><qCom>37000.0000</qCom></prod></det>
    <det nItem="2"><prod><xProd>MILHO</xProd><uCom>${u2}</uCom><qCom>500.5</qCom></prod></det>
    <total><ICMSTot><vNF>45678.90</vNF></ICMSTot></total>
    <transp><veicTransp><placa>RVG-1A23</placa></veicTransp><vol><pesoL>37500.500</pesoL><pesoB>37600.000</pesoB></vol></transp>
  </infNFe></NFe>`;
  if (opts.wrap === false) return `<?xml version="1.0" encoding="UTF-8"?>${inner}`;
  const prot = opts.cStat === null ? '' : `<protNFe><infProt><chNFe>${opts.protocolKey ?? key}</chNFe><cStat>${opts.cStat ?? '100'}</cStat></infProt></protNFe>`;
  return `<?xml version="1.0" encoding="UTF-8"?><nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">${inner}${prot}</nfeProc>`;
};

describe('parseNfe', () => {
  it('extrai dados da nota autorizada', () => {
    const r = parseNfe(nfe());
    expect(r).toMatchObject({
      accessKey: KEY,
      number: '1234',
      series: '1',
      issuedAt: '2026-09-10T11:30:00.000Z',
      issuer: { document: '12345678000190', name: 'Produtor Teste' },
      recipient: { document: '98765432000110' },
      totalValue: '45678.90',
      quantity: '37500.5',
      quantityUnit: 'KG',
      netWeightKg: '37500.5',
      grossWeightKg: '37600',
      plate: 'RVG1A23',
      protocolStatus: '100',
    });
  });

  it('aceita NFe sem envelope nfeProc (sem protocolo)', () => {
    const r = parseNfe(nfe({ wrap: false }));
    expect(r.accessKey).toBe(KEY);
    expect(r.protocolStatus).toBeNull();
  });

  it('não soma quantidade com unidades diferentes', () => {
    const r = parseNfe(nfe({ units: ['KG', 'SC'] }));
    expect(r.quantity).toBeNull();
    expect(r.quantityUnit).toBeNull();
  });

  it.each([
    ['DTD/entidades', `<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "b">]><x>&a;</x>`, 'INVALID_XML'],
    ['XML malformado', '<nfeProc><NFe>', 'INVALID_XML'],
    ['outro documento', '<?xml version="1.0"?><pedido><id>1</id></pedido>', 'NOT_NFE'],
    ['dígito verificador errado', nfe({ key: `${KEY.slice(0, 43)}${(Number(KEY[43]) + 1) % 10}` }), 'INVALID_ACCESS_KEY'],
    ['protocolo de outra chave', nfe({ protocolKey: withCheckDigit('35' + KEY.slice(2, 43)) }), 'KEY_MISMATCH'],
  ])('rejeita %s', (_label, xml, code) => {
    try {
      parseNfe(xml);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(NfeParseError);
      expect((err as NfeParseError).code).toBe(code);
    }
  });
});

describe('utilitários', () => {
  it('valida chave de acesso', () => {
    expect(isValidAccessKey(KEY)).toBe(true);
    expect(isValidAccessKey(KEY.slice(1))).toBe(false);
  });

  it('soma decimais sem ponto flutuante', () => {
    expect(sumDecimal(['0.1', '0.2'])).toBe('0.3');
    expect(sumDecimal(['10', null, 'abc'])).toBe('10');
    expect(sumDecimal([null])).toBeNull();
  });
});

describe('evaluateDivergences', () => {
  const base = { loadPlates: ['RVG1A23'], loadNetKg: new Prisma.Decimal('37500'), tolerancePct: new Prisma.Decimal('0'), origin: 'FARM' as const, sellerDocument: '12.345.678/0001-90' };

  it('nota coerente não gera divergência', () => {
    expect(evaluateDivergences(parseNfe(nfe()), base)).toEqual([]);
  });

  it('aponta emitente, placa, peso e ausência de protocolo', () => {
    const codes = evaluateDivergences(parseNfe(nfe({ wrap: false })), {
      ...base,
      loadPlates: ['PRS3C45'],
      loadNetKg: new Prisma.Decimal('30000'),
      sellerDocument: '11111111000111',
    }).map((d) => d.code);
    expect(codes).toEqual(['ISSUER_MISMATCH', 'PLATE_MISMATCH', 'WEIGHT_MISMATCH', 'NO_PROTOCOL']);
  });

  it('respeita a tolerância mínima de 0,5% no peso', () => {
    // 37.500,5 vs 37.400: diferença 100,5 kg < 0,5% de 37.400 (187 kg).
    expect(evaluateDivergences(parseNfe(nfe()), { ...base, loadNetKg: new Prisma.Decimal('37400') })).toEqual([]);
  });
});
