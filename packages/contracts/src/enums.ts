/**
 * Enums de domínio compartilhados. Espelham os enums do PostgreSQL (packages/db/prisma/schema.prisma).
 * Nunca usar strings livres para status.
 */

const values = <T extends Record<string, string>>(obj: T) => Object.values(obj) as [T[keyof T], ...T[keyof T][]];

export const Scope = {
  PLATFORM: 'PLATFORM',
  MATRIZ: 'MATRIZ',
  FARM: 'FARM',
  BUYER: 'BUYER',
  CARRIER: 'CARRIER',
} as const;
export type Scope = (typeof Scope)[keyof typeof Scope];
export const SCOPES = values(Scope);

export const OrgKind = {
  MATRIZ: 'MATRIZ',
  FARM: 'FARM',
  BUYER: 'BUYER',
  CARRIER: 'CARRIER',
} as const;
export type OrgKind = (typeof OrgKind)[keyof typeof OrgKind];
export const ORG_KINDS = values(OrgKind);

export const PartnerRole = {
  BUYER: 'BUYER',
  SELLER: 'SELLER',
  PRODUCER: 'PRODUCER',
  COOPERATIVE_MEMBER: 'COOPERATIVE_MEMBER',
  COOPERATIVE: 'COOPERATIVE',
  CARRIER: 'CARRIER',
  OTHER: 'OTHER',
} as const;
export type PartnerRole = (typeof PartnerRole)[keyof typeof PartnerRole];
export const PARTNER_ROLES = values(PartnerRole);

export const PersonType = { PF: 'PF', PJ: 'PJ' } as const;
export type PersonType = (typeof PersonType)[keyof typeof PersonType];

export const RecordStatus = { ACTIVE: 'ACTIVE', INACTIVE: 'INACTIVE', BLOCKED: 'BLOCKED' } as const;
export type RecordStatus = (typeof RecordStatus)[keyof typeof RecordStatus];

export const OrderStatus = {
  DRAFT: 'DRAFT',
  PUBLISHED: 'PUBLISHED',
  IN_PROGRESS: 'IN_PROGRESS',
  SUSPENDED: 'SUSPENDED',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
} as const;
export type OrderStatus = (typeof OrderStatus)[keyof typeof OrderStatus];
export const ORDER_STATUSES = values(OrderStatus);

export const OrderPriority = { LOW: 'LOW', NORMAL: 'NORMAL', HIGH: 'HIGH', URGENT: 'URGENT' } as const;
export type OrderPriority = (typeof OrderPriority)[keyof typeof OrderPriority];
export const ORDER_PRIORITIES = values(OrderPriority);

export const OperationType = {
  PURCHASE: 'PURCHASE',
  SALE: 'SALE',
  TRANSFER: 'TRANSFER',
  STORAGE: 'STORAGE',
} as const;
export type OperationType = (typeof OperationType)[keyof typeof OperationType];
export const OPERATION_TYPES = values(OperationType);

export const FreightMode = {
  CIF: 'CIF',
  FOB: 'FOB',
  THIRD_PARTY: 'THIRD_PARTY',
  TO_DEFINE: 'TO_DEFINE',
} as const;
export type FreightMode = (typeof FreightMode)[keyof typeof FreightMode];
export const FREIGHT_MODES = values(FreightMode);

export const ReleaseStatus = {
  ACTIVE: 'ACTIVE',
  CONSUMED: 'CONSUMED',
  EXPIRED: 'EXPIRED',
  CANCELLED: 'CANCELLED',
} as const;
export type ReleaseStatus = (typeof ReleaseStatus)[keyof typeof ReleaseStatus];

export const LoadStatus = {
  SCHEDULED: 'SCHEDULED',
  CONFIRMED: 'CONFIRMED',
  AWAITING_LOADING: 'AWAITING_LOADING',
  LOADING: 'LOADING',
  AWAITING_FARM_INVOICE: 'AWAITING_FARM_INVOICE',
  FARM_INVOICED: 'FARM_INVOICED',
  LOADED: 'LOADED',
  IN_TRANSIT: 'IN_TRANSIT',
  ARRIVED: 'ARRIVED',
  RECEIVED: 'RECEIVED',
  CHECKED: 'CHECKED',
  AWAITING_MATRIZ_INVOICE: 'AWAITING_MATRIZ_INVOICE',
  MATRIZ_INVOICED: 'MATRIZ_INVOICED',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
} as const;
export type LoadStatus = (typeof LoadStatus)[keyof typeof LoadStatus];
export const LOAD_STATUSES = values(LoadStatus);

export const UploadStatus = {
  PENDING: 'PENDING',
  UPLOADING: 'UPLOADING',
  UPLOADED: 'UPLOADED',
  PROCESSING: 'PROCESSING',
  AVAILABLE: 'AVAILABLE',
  REJECTED: 'REJECTED',
  INFECTED: 'INFECTED',
  ABORTED: 'ABORTED',
  EXPIRED: 'EXPIRED',
} as const;
export type UploadStatus = (typeof UploadStatus)[keyof typeof UploadStatus];

export const ScanStatus = {
  PENDING: 'PENDING',
  CLEAN: 'CLEAN',
  INFECTED: 'INFECTED',
  ERROR: 'ERROR',
  SKIPPED_DEV: 'SKIPPED_DEV',
} as const;
export type ScanStatus = (typeof ScanStatus)[keyof typeof ScanStatus];

export const DocumentKind = {
  NFE_XML: 'NFE_XML',
  PDF: 'PDF',
  IMAGE: 'IMAGE',
  SPREADSHEET: 'SPREADSHEET',
  OTHER: 'OTHER',
} as const;
export type DocumentKind = (typeof DocumentKind)[keyof typeof DocumentKind];
export const DOCUMENT_KINDS = values(DocumentKind);

export const InvoiceOrigin = { FARM: 'FARM', MATRIZ: 'MATRIZ' } as const;
export type InvoiceOrigin = (typeof InvoiceOrigin)[keyof typeof InvoiceOrigin];
export const INVOICE_ORIGINS = values(InvoiceOrigin);

export const InvoiceStatus = {
  VALID: 'VALID',
  DIVERGENT: 'DIVERGENT',
  REJECTED: 'REJECTED',
  CANCELLED: 'CANCELLED',
} as const;
export type InvoiceStatus = (typeof InvoiceStatus)[keyof typeof InvoiceStatus];
export const INVOICE_STATUSES = values(InvoiceStatus);

export const OccurrenceType = {
  WEIGHT_DIVERGENCE: 'WEIGHT_DIVERGENCE',
  QUALITY: 'QUALITY',
  DELAY: 'DELAY',
  DOCUMENT: 'DOCUMENT',
  VEHICLE: 'VEHICLE',
  ACCIDENT: 'ACCIDENT',
  OTHER: 'OTHER',
} as const;
export type OccurrenceType = (typeof OccurrenceType)[keyof typeof OccurrenceType];
export const OCCURRENCE_TYPES = values(OccurrenceType);

export const OccurrenceSeverity = { LOW: 'LOW', MEDIUM: 'MEDIUM', HIGH: 'HIGH', CRITICAL: 'CRITICAL' } as const;
export type OccurrenceSeverity = (typeof OccurrenceSeverity)[keyof typeof OccurrenceSeverity];
export const OCCURRENCE_SEVERITIES = values(OccurrenceSeverity);

export const OccurrenceStatus = { OPEN: 'OPEN', IN_PROGRESS: 'IN_PROGRESS', RESOLVED: 'RESOLVED', CANCELLED: 'CANCELLED' } as const;
export type OccurrenceStatus = (typeof OccurrenceStatus)[keyof typeof OccurrenceStatus];
export const OCCURRENCE_STATUSES = values(OccurrenceStatus);

/** Quem, além da Matriz, enxerga um documento ou ocorrência. */
export const DocumentVisibility = { INTERNAL: 'INTERNAL', FARM: 'FARM', BUYER: 'BUYER', PARTIES: 'PARTIES' } as const;
export type DocumentVisibility = (typeof DocumentVisibility)[keyof typeof DocumentVisibility];
export const DOCUMENT_VISIBILITIES = values(DocumentVisibility);

export const Theme = { LIGHT: 'light', DARK: 'dark', SYSTEM: 'system' } as const;
export type Theme = (typeof Theme)[keyof typeof Theme];
export const THEMES = values(Theme);

export const ViewSignal = {
  NEVER: 'NEVER',
  CURRENT: 'CURRENT',
  OUTDATED: 'OUTDATED',
  OVERDUE: 'OVERDUE',
  /** Parte sem organização/usuários no portal: não há quem visualize. */
  NO_PORTAL: 'NO_PORTAL',
} as const;
export type ViewSignal = (typeof ViewSignal)[keyof typeof ViewSignal];
