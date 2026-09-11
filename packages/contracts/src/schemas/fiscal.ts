import { z } from 'zod';
import {
  DOCUMENT_VISIBILITIES,
  INVOICE_ORIGINS,
  OCCURRENCE_SEVERITIES,
  OCCURRENCE_STATUSES,
  OCCURRENCE_TYPES,
  type DocumentKind,
  type DocumentVisibility,
  type InvoiceOrigin,
  type InvoiceStatus,
  type OccurrenceSeverity,
  type OccurrenceStatus,
  type OccurrenceType,
  type ScanStatus,
  type Scope,
  type UploadStatus,
} from '../enums.js';

// ───────────────────────────── Rótulos ─────────────────────────────

export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  VALID: 'Válida',
  DIVERGENT: 'Com divergência',
  REJECTED: 'Rejeitada',
  CANCELLED: 'Cancelada',
};

export const INVOICE_ORIGIN_LABELS: Record<InvoiceOrigin, string> = { FARM: 'Fazenda', MATRIZ: 'Matriz' };

export const OCCURRENCE_TYPE_LABELS: Record<OccurrenceType, string> = {
  WEIGHT_DIVERGENCE: 'Divergência de peso',
  QUALITY: 'Qualidade',
  DELAY: 'Atraso',
  DOCUMENT: 'Documentação',
  VEHICLE: 'Veículo',
  ACCIDENT: 'Acidente / sinistro',
  OTHER: 'Outro',
};

export const OCCURRENCE_SEVERITY_LABELS: Record<OccurrenceSeverity, string> = { LOW: 'Baixa', MEDIUM: 'Média', HIGH: 'Alta', CRITICAL: 'Crítica' };

export const OCCURRENCE_STATUS_LABELS: Record<OccurrenceStatus, string> = {
  OPEN: 'Aberta',
  IN_PROGRESS: 'Em tratamento',
  RESOLVED: 'Resolvida',
  CANCELLED: 'Cancelada',
};

export const DOCUMENT_VISIBILITY_LABELS: Record<DocumentVisibility, string> = {
  INTERNAL: 'Somente Matriz',
  FARM: 'Matriz e Fazenda',
  BUYER: 'Matriz e Comprador',
  PARTIES: 'Matriz, Fazenda e Comprador',
};

export const DOCUMENT_KIND_LABELS: Record<DocumentKind, string> = {
  NFE_XML: 'NF-e (XML)',
  PDF: 'PDF',
  IMAGE: 'Imagem',
  SPREADSHEET: 'Planilha',
  OTHER: 'Outro',
};

// ───────────────────────────── Máquina de estados ─────────────────────────────

export const OCCURRENCE_TRANSITIONS: Record<OccurrenceStatus, readonly OccurrenceStatus[]> = {
  OPEN: ['IN_PROGRESS', 'RESOLVED', 'CANCELLED'],
  IN_PROGRESS: ['RESOLVED', 'CANCELLED'],
  RESOLVED: ['OPEN'],
  CANCELLED: [],
};

/** Escopos autorizados a mover uma ocorrência PARA cada status (Q14: só a Matriz encerra). */
export const OCCURRENCE_TRANSITION_SCOPES: Record<OccurrenceStatus, readonly Scope[]> = {
  OPEN: ['MATRIZ'],
  IN_PROGRESS: ['MATRIZ', 'FARM'],
  RESOLVED: ['MATRIZ'],
  CANCELLED: ['MATRIZ'],
};

export function canTransitionOccurrence(from: OccurrenceStatus, to: OccurrenceStatus, scope: Scope): boolean {
  return OCCURRENCE_TRANSITIONS[from].includes(to) && OCCURRENCE_TRANSITION_SCOPES[to].includes(scope);
}

// ───────────────────────────── NF-e ─────────────────────────────

/** Divergências não bloqueiam (Q15): a nota fica "Com divergência". */
export const INVOICE_DIVERGENCE_LABELS = {
  ISSUER_MISMATCH: 'Emitente diferente do vendedor da ordem',
  PLATE_MISMATCH: 'Placa diferente das placas da carga',
  WEIGHT_MISMATCH: 'Peso líquido fora da tolerância da ordem',
  NO_PROTOCOL: 'XML sem protocolo de autorização',
} as const;
export type InvoiceDivergenceCode = keyof typeof INVOICE_DIVERGENCE_LABELS;

export const INVOICE_REJECT_LABELS = {
  INVALID_XML: 'Arquivo XML malformado ou com DTD',
  NOT_NFE: 'O arquivo não é uma NF-e',
  INVALID_ACCESS_KEY: 'Chave de acesso inválida',
  KEY_MISMATCH: 'Chave do protocolo diferente da nota',
  NOT_AUTHORIZED: 'NF-e não autorizada pela SEFAZ',
  DUPLICATE: 'Chave de acesso já registrada em outra carga',
} as const;
export type InvoiceRejectCode = keyof typeof INVOICE_REJECT_LABELS;

export interface InvoiceIssue {
  code: InvoiceDivergenceCode;
  message: string;
  expected?: string | null;
  actual?: string | null;
}

/** Dados extraídos do XML (sem ponto flutuante: decimais em string). */
export interface NfeExtract {
  accessKey: string;
  number: string;
  series: string | null;
  issuedAt: string | null;
  issuer: { document: string | null; name: string | null };
  recipient: { document: string | null; name: string | null };
  totalValue: string | null;
  quantity: string | null;
  quantityUnit: string | null;
  productDescription: string | null;
  netWeightKg: string | null;
  grossWeightKg: string | null;
  plate: string | null;
  protocolStatus: string | null;
  protocolKey: string | null;
}

// ───────────────────────────── Entradas ─────────────────────────────

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v))
    .nullish();

const optionalDate = z
  .union([z.literal(''), z.iso.date()])
  .transform((v) => (v === '' ? null : v))
  .nullish();

const many = z
  .union([z.string(), z.array(z.string())])
  .transform((v) => (Array.isArray(v) ? v : [v]))
  .optional();

const paging = {
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(10).max(200).default(50),
  q: z.string().trim().max(120).optional(),
};

export const occurrenceInputSchema = z.object({
  orderId: z.uuid(),
  loadId: z.uuid().nullish(),
  type: z.enum(OCCURRENCE_TYPES),
  severity: z.enum(OCCURRENCE_SEVERITIES).default('MEDIUM'),
  title: z.string().trim().min(3, 'Informe um título').max(160),
  description: text(4000),
  visibility: z.enum(DOCUMENT_VISIBILITIES).default('INTERNAL'),
  responsibleUserId: z.uuid().nullish(),
  dueOn: optionalDate,
});
export type OccurrenceInput = z.input<typeof occurrenceInputSchema>;

export const occurrenceUpdateSchema = occurrenceInputSchema.omit({ orderId: true, loadId: true }).extend({ expectedUpdatedAt: z.iso.datetime() });
export type OccurrenceUpdateInput = z.input<typeof occurrenceUpdateSchema>;

export const occurrenceTransitionSchema = z.object({
  to: z.enum(OCCURRENCE_STATUSES),
  expectedUpdatedAt: z.iso.datetime(),
  resolution: text(4000),
});
export type OccurrenceTransitionInput = z.input<typeof occurrenceTransitionSchema>;

export const occurrenceListQuery = z.object({
  ...paging,
  status: many,
  type: many,
  severity: many,
  orderId: z.uuid().optional(),
  loadId: z.uuid().optional(),
});
export type OccurrenceListQuery = z.infer<typeof occurrenceListQuery>;

export const invoiceListQuery = z.object({
  ...paging,
  status: many,
  origin: z.enum(INVOICE_ORIGINS).optional(),
  orderId: z.uuid().optional(),
  loadId: z.uuid().optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
});
export type InvoiceListQuery = z.infer<typeof invoiceListQuery>;

export const invoiceCancelSchema = z.object({ reason: z.string().trim().min(3, 'Informe o motivo').max(500) });

export const documentListQuery = z.object({
  ...paging,
  kind: many,
  entityType: z.enum(['loading_order', 'load', 'contract', 'partner', 'farm', 'occurrence']).optional(),
  entityId: z.uuid().optional(),
  visibility: z.enum(DOCUMENT_VISIBILITIES).optional(),
});
export type DocumentListQuery = z.infer<typeof documentListQuery>;

export const documentVisibilitySchema = z.object({ visibility: z.enum(DOCUMENT_VISIBILITIES) });

// ───────────────────────────── Saídas ─────────────────────────────

export interface InvoiceDto {
  id: string;
  load: { id: string; number: string; plates: string[] };
  order: { id: string; number: string };
  origin: InvoiceOrigin;
  status: InvoiceStatus;
  accessKey: string | null;
  number: string | null;
  series: string | null;
  issuedAt: string | null;
  issuer: { document: string | null; name: string | null };
  recipient: { document: string | null; name: string | null };
  totalValue: string | null;
  netWeightKg: string | null;
  grossWeightKg: string | null;
  quantity: string | null;
  quantityUnit: string | null;
  productDescription: string | null;
  plate: string | null;
  protocolStatus: string | null;
  divergences: InvoiceIssue[];
  rejectReason: InvoiceRejectCode | null;
  cancelReason: string | null;
  fileUploadId: string | null;
  createdAt: string;
  canCancel: boolean;
}

export interface OccurrenceDto {
  id: string;
  number: string;
  order: { id: string; number: string };
  load: { id: string; number: string } | null;
  type: OccurrenceType;
  severity: OccurrenceSeverity;
  status: OccurrenceStatus;
  title: string;
  description: string | null;
  visibility: DocumentVisibility;
  responsible: { id: string; name: string } | null;
  dueOn: string | null;
  overdue: boolean;
  resolution: string | null;
  resolvedAt: string | null;
  source: 'MANUAL' | 'SYSTEM';
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  allowedTransitions: OccurrenceStatus[];
}

export interface DocumentDto {
  id: string;
  kind: DocumentKind;
  fileName: string;
  sizeBytes: string;
  status: UploadStatus;
  scanStatus: ScanStatus;
  visibility: DocumentVisibility;
  entity: { type: string; id: string; label: string | null };
  order: { id: string; number: string } | null;
  uploadedBy: string | null;
  organization: string | null;
  invoiceStatus: InvoiceStatus | null;
  createdAt: string;
  canChangeVisibility: boolean;
}
