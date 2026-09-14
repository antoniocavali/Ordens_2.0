import type { InvoiceRejectCode, NfeExtract } from '@ordens/contracts';
import { XMLParser } from 'fast-xml-parser';

export class NfeParseError extends Error {
  constructor(
    readonly code: Extract<InvoiceRejectCode, 'INVALID_XML' | 'NOT_NFE' | 'INVALID_ACCESS_KEY' | 'KEY_MISMATCH'>,
    message: string,
  ) {
    super(message);
  }
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  processEntities: false,
  isArray: (name) => name === 'det' || name === 'vol',
});

type Node = Record<string, unknown>;

const node = (v: unknown): Node | undefined => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Node) : undefined);
const list = (v: unknown): Node[] => (Array.isArray(v) ? v.map(node).filter((n): n is Node => Boolean(n)) : []);

function text(v: unknown): string | null {
  if (typeof v === 'string') return v.trim() || null;
  if (typeof v === 'number') return String(v);
  const n = node(v);
  return n ? text(n['#text']) : null;
}

const digits = (v: string | null) => (v ? v.replace(/\D/g, '') || null : null);

/** Dígito verificador da chave de acesso (módulo 11, pesos 2..9 da direita para a esquerda). */
export function isValidAccessKey(key: string): boolean {
  if (!/^\d{44}$/.test(key)) return false;
  let weight = 2;
  let sum = 0;
  for (let i = 42; i >= 0; i--) {
    sum += Number(key[i]) * weight;
    weight = weight === 9 ? 2 : weight + 1;
  }
  const rest = sum % 11;
  return (rest < 2 ? 0 : 11 - rest) === Number(key[43]);
}

/** Soma decimais em string sem ponto flutuante. Valores não numéricos são ignorados. */
export function sumDecimal(values: (string | null)[], scale = 4): string | null {
  const present = values.filter((v): v is string => v !== null && /^-?\d+(\.\d+)?$/.test(v));
  if (!present.length) return null;
  const factor = 10n ** BigInt(scale);
  let total = 0n;
  for (const v of present) {
    const negative = v.startsWith('-');
    const [int, frac = ''] = v.replace('-', '').split('.');
    const n = BigInt(int!) * factor + BigInt((frac + '0'.repeat(scale)).slice(0, scale));
    total += negative ? -n : n;
  }
  const negative = total < 0n;
  const abs = negative ? -total : total;
  const frac = (abs % factor).toString().padStart(scale, '0').replace(/0+$/, '');
  return `${negative ? '-' : ''}${abs / factor}${frac ? `.${frac}` : ''}`;
}

function isoDate(v: string | null): string | null {
  if (!v) return null;
  // dEmi (layouts antigos) não tem hora nem fuso: assume horário de Brasília.
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T00:00:00-03:00` : v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Extrai os dados relevantes de uma NF-e (modelo 55), com ou sem envelope `nfeProc`.
 * DTD/entidades são recusados antes do parse (sem XXE nem expansão de entidades).
 */
export function parseNfe(xml: string): NfeExtract {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new NfeParseError('INVALID_XML', 'XML com DTD ou entidades não é aceito.');

  let doc: Node;
  try {
    const result = parser.parse(xml, true);
    doc = node(result) ?? {};
  } catch {
    throw new NfeParseError('INVALID_XML', 'Arquivo XML malformado.');
  }

  const proc = node(doc.nfeProc);
  const inf = node(node(proc?.NFe ?? doc.NFe)?.infNFe);
  if (!inf) throw new NfeParseError('NOT_NFE', 'O arquivo não é uma NF-e.');

  const accessKey = (text(inf['@_Id']) ?? '').replace(/^NFe/, '');
  if (!isValidAccessKey(accessKey)) throw new NfeParseError('INVALID_ACCESS_KEY', 'Chave de acesso inválida.');

  const infProt = node(node(proc?.protNFe)?.infProt);
  const protocolKey = digits(text(infProt?.chNFe));
  if (protocolKey && protocolKey !== accessKey) throw new NfeParseError('KEY_MISMATCH', 'A chave do protocolo não corresponde à nota.');

  const ide = node(inf.ide) ?? {};
  const emit = node(inf.emit) ?? {};
  const dest = node(inf.dest) ?? {};
  const products = list(inf.det).map((d) => node(d.prod) ?? {});
  const units = [...new Set(products.map((p) => text(p.uCom)?.toUpperCase()).filter((u): u is string => Boolean(u)))];
  const transp = node(inf.transp) ?? {};
  const volumes = list(transp.vol);
  const plate = text(node(transp.veicTransp)?.placa)?.toUpperCase().replace(/[^A-Z0-9]/g, '') || null;
  // Quantidade só é somada quando todos os itens usam a mesma unidade comercial.
  const singleUnit = units.length === 1 ? units[0]! : null;

  return {
    accessKey,
    number: text(ide.nNF) ?? String(Number(accessKey.slice(25, 34))),
    series: text(ide.serie),
    issuedAt: isoDate(text(ide.dhEmi) ?? text(ide.dEmi)),
    issuer: { document: digits(text(emit.CNPJ) ?? text(emit.CPF)), name: text(emit.xNome) },
    recipient: { document: digits(text(dest.CNPJ) ?? text(dest.CPF)), name: text(dest.xNome) },
    totalValue: text(node(node(inf.total)?.ICMSTot)?.vNF),
    quantity: singleUnit ? sumDecimal(products.map((p) => text(p.qCom))) : null,
    quantityUnit: singleUnit,
    productDescription: products.map((p) => text(p.xProd)).filter(Boolean).join('; ').slice(0, 500) || null,
    netWeightKg: sumDecimal(volumes.map((v) => text(v.pesoL))),
    grossWeightKg: sumDecimal(volumes.map((v) => text(v.pesoB))),
    plate,
    protocolStatus: text(infProt?.cStat),
    protocolKey,
  };
}
