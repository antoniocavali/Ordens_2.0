import { z } from 'zod';
import {
  FREIGHT_MODES,
  OPERATION_TYPES,
  ORDER_PRIORITIES,
  ORDER_STATUSES,
  type FreightMode,
  type OperationType,
  type OrderOrigin,
  type OrderPriority,
  type OrderStatus,
  type ReleaseStatus,
  type ViewSignal,
} from '../enums.js';
import { moneyString, percentString, priceString, quantityString } from '../decimal.js';
import { checkTransport, transportFields, type TransportDto } from './logistics.js';

/**
 * Campos materiais: alteração após publicação gera nova versão (docs/versioning.md).
 * Nomes em camelCase conforme DTO.
 */
export const ORDER_MATERIAL_FIELDS = [
  'quantity',
  'unitId',
  'commodityId',
  'farmId',
  'sellerPartnerId',
  'buyerPartnerId',
  'contractId',
  'cropYear',
  'loadingStartsOn',
  'loadingEndsOn',
  'carrierName',
  'driverName',
  'driverCpf',
  'vehicles',
  'loadingLocationName',
  'loadingLocationAddress',
  'loadingLocationCity',
  'loadingLocationState',
  'destinationName',
  'destinationAddress',
  'destinationCity',
  'destinationState',
  'unitPrice',
  'currency',
  'tolerancePct',
  'requiresReceipt',
  'freightMode',
  'commercialTerms',
  'loadingInstructions',
  'farmNotes',
  'buyerNotes',
] as const;
export type OrderMaterialField = (typeof ORDER_MATERIAL_FIELDS)[number];

const dateOnly = z.iso.date();
const optionalText = (max: number) => z.string().trim().max(max).nullish();

/** Rascunho: tudo opcional; validações de consistência continuam valendo para o que for informado. */
export const orderDraftSchema = z
  .object({
    externalNumber: optionalText(60),
    orderDate: dateOnly.nullish(),
    priority: z.enum(ORDER_PRIORITIES).nullish(),
    operationType: z.enum(OPERATION_TYPES).nullish(),
    contractId: z.uuid().nullish(),
    sellerPartnerId: z.uuid().nullish(),
    farmId: z.uuid().nullish(),
    buyerPartnerId: z.uuid().nullish(),
    commodityId: z.uuid().nullish(),
    cropYear: z
      .string()
      .regex(/^\d{2}\/\d{2}$|^\d{4}$/, 'Safra no formato 25/26 ou 2026')
      .nullish(),
    quantity: quantityString.nullish(),
    unitId: z.uuid().nullish(),
    unitPrice: priceString.nullish(),
    currency: z.enum(['BRL', 'USD']).nullish(),
    freightMode: z.enum(FREIGHT_MODES).nullish(),
    freightEstimate: moneyString.nullish(),
    // Transporte digitado na própria ordem (ADR-010): o agendamento herda e pode corrigir.
    ...transportFields,
    loadingStartsOn: dateOnly.nullish(),
    loadingEndsOn: dateOnly.nullish(),
    /** Local de carregamento digitado: para onde o motorista vai (silo, armazém, ponto da fazenda). */
    loadingLocationName: optionalText(160),
    loadingLocationAddress: optionalText(255),
    loadingLocationCity: optionalText(120),
    loadingLocationState: z.string().length(2).toUpperCase().nullish(),
    tolerancePct: percentString.nullish(),
    /** Recebimento no destino exigido (padrão). Falso: a carga vai do trânsito direto ao faturamento da Matriz. */
    requiresReceipt: z.boolean().nullish(),
    destinationName: optionalText(160),
    destinationAddress: optionalText(255),
    destinationCity: optionalText(120),
    destinationState: z.string().length(2).toUpperCase().nullish(),
    commercialTerms: optionalText(4000),
    loadingInstructions: optionalText(4000),
    internalNotes: optionalText(4000),
    farmNotes: optionalText(4000),
    buyerNotes: optionalText(4000),
    initialReleaseQty: quantityString.nullish(),
  })
  .refine((v) => !v.loadingStartsOn || !v.loadingEndsOn || v.loadingStartsOn <= v.loadingEndsOn, {
    message: 'A data limite deve ser posterior à data inicial',
    path: ['loadingEndsOn'],
  })
  .superRefine(checkTransport);
export type OrderDraftInput = z.infer<typeof orderDraftSchema>;
/** O que a tela envia (antes das transformações do Zod): eixos e quantidades chegam como texto. */
export type OrderDraftPayload = z.input<typeof orderDraftSchema>;

export const updateOrderSchema = z.object({
  expectedVersion: z.number().int().min(0),
  expectedUpdatedAt: z.iso.datetime(),
  data: orderDraftSchema,
});
export type UpdateOrderInput = z.infer<typeof updateOrderSchema>;

export const ORDER_ORIGIN_LABELS = { MATRIZ: 'Matriz', BUYER: 'Portal do Comprador' } as const;

/**
 * Portal do Comprador (Q41): somente os campos que pertencem ao Comprador. Objeto estrito — vendedor, fazenda,
 * contrato, preço, comprador ou qualquer campo interno da Matriz são recusados na validação.
 */
export const buyerOrderSchema = z
  .strictObject({
    externalNumber: optionalText(60),
    commodityId: z.uuid().nullish(),
    cropYear: z
      .string()
      .regex(/^\d{2}\/\d{2}$|^\d{4}$/, 'Safra no formato 25/26 ou 2026')
      .nullish(),
    quantity: quantityString.nullish(),
    unitId: z.uuid().nullish(),
    loadingStartsOn: dateOnly.nullish(),
    loadingEndsOn: dateOnly.nullish(),
    destinationName: optionalText(160),
    destinationAddress: optionalText(255),
    destinationCity: optionalText(120),
    destinationState: z.string().length(2).toUpperCase().nullish(),
    freightMode: z.enum(FREIGHT_MODES).nullish(),
    ...transportFields,
    buyerNotes: optionalText(4000),
  })
  .refine((v) => !v.loadingStartsOn || !v.loadingEndsOn || v.loadingStartsOn <= v.loadingEndsOn, {
    message: 'A data limite deve ser posterior à data inicial',
    path: ['loadingEndsOn'],
  })
  .superRefine(checkTransport);
export type BuyerOrderInput = z.infer<typeof buyerOrderSchema>;
export type BuyerOrderPayload = z.input<typeof buyerOrderSchema>;

export const updateBuyerOrderSchema = z.strictObject({
  expectedUpdatedAt: z.iso.datetime(),
  data: buyerOrderSchema,
});
export type UpdateBuyerOrderInput = z.infer<typeof updateBuyerOrderSchema>;

/** Campos exigidos para o Comprador enviar ao Faturamento. */
export const BUYER_SUBMIT_REQUIRED = ['commodityId', 'quantity', 'unitId', 'loadingStartsOn', 'loadingEndsOn'] as const satisfies readonly (keyof BuyerOrderInput)[];

export const submitOrderSchema = z.strictObject({ expectedUpdatedAt: z.iso.datetime() });

/** Devolução ao Comprador (Faturamento) e cancelamento pelo Comprador: motivo obrigatório. */
export const orderReasonActionSchema = z.strictObject({
  expectedUpdatedAt: z.iso.datetime(),
  reason: z.string().trim().min(3, 'Informe o motivo').max(1000),
});
export type OrderReasonActionInput = z.infer<typeof orderReasonActionSchema>;

export const resumeOrderSchema = z.strictObject({ expectedUpdatedAt: z.iso.datetime() });

/**
 * Conclusão pela Matriz (Q45): motivo obrigatório quando sobra saldo a carregar; `acceptPendingDocuments`
 * é o aceite explícito quando alguma carga ainda não tem PDF e XML da Fazenda validados.
 */
export const completeOrderSchema = z.strictObject({
  expectedUpdatedAt: z.iso.datetime(),
  reason: z.string().trim().min(3, 'Informe o motivo').max(1000).nullish(),
  acceptPendingDocuments: z.boolean().default(false),
});
export type CompleteOrderInput = z.infer<typeof completeOrderSchema>;

/** Conferência antes de concluir: o que a Matriz precisa aceitar ou justificar. */
export interface OrderCompletionCheck {
  /** Cargas ainda em andamento: impedem a conclusão. */
  activeLoads: string[];
  /** Cargas sem PDF e XML da Fazenda validados: exigem aceite explícito. */
  pendingDocuments: PendingDocumentLoad[];
  /** Saldo a carregar; maior que zero exige motivo. */
  balance: string;
  unit: string;
  loadsTotal: number;
}

/** Cargas sem documentação fiscal completa, devolvidas no erro ORDER_DOCUMENTS_PENDING. */
export interface PendingDocumentLoad {
  id: string;
  number: string;
  issues: string[];
}

/** Faturamento: completa dados internos e define vendedor/fazenda (a ordem continua aguardando faturamento). */
export const assignFarmSchema = z.strictObject({
  expectedUpdatedAt: z.iso.datetime(),
  sellerPartnerId: z.uuid('Selecione o vendedor'),
  farmId: z.uuid('Selecione a fazenda'),
  contractId: z.uuid().nullish(),
  unitPrice: priceString.nullish(),
  tolerancePct: percentString.nullish(),
  requiresReceipt: z.boolean().optional(),
  loadingInstructions: optionalText(4000),
  farmNotes: optionalText(4000),
  internalNotes: optionalText(4000),
});
export type AssignFarmInput = z.infer<typeof assignFarmSchema>;

/** Campos exigidos para publicar. */
export const ORDER_PUBLISH_REQUIRED = [
  'sellerPartnerId',
  'farmId',
  'buyerPartnerId',
  'commodityId',
  'quantity',
  'unitId',
  'loadingStartsOn',
  'loadingEndsOn',
] as const satisfies readonly (keyof OrderDraftInput)[];

export const publishOrderSchema = z.object({
  expectedUpdatedAt: z.iso.datetime(),
});

export const createReleaseSchema = z.object({
  quantity: quantityString,
  validUntil: dateOnly.nullish(),
  notes: optionalText(1000),
  expectedVersion: z.number().int().min(1),
});
export type CreateReleaseInput = z.infer<typeof createReleaseSchema>;

export const cancelReleaseSchema = z.object({
  reason: z.string().trim().min(3, 'Informe o motivo do cancelamento').max(500),
  expectedVersion: z.number().int().min(1),
});
export type CancelReleaseInput = z.infer<typeof cancelReleaseSchema>;

export const RELEASE_STATUS_LABELS: Record<ReleaseStatus, string> = {
  ACTIVE: 'Ativa',
  CONSUMED: 'Consumida',
  EXPIRED: 'Expirada',
  CANCELLED: 'Cancelada',
};

/** Janela de "vence em breve" da tela de liberações. */
export const RELEASE_EXPIRING_DAYS = 7;

export const releaseListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(10).max(200).default(50),
  q: z.string().trim().max(60).optional(),
  status: z
    .union([z.enum(['ACTIVE', 'CONSUMED', 'EXPIRED', 'CANCELLED']), z.array(z.enum(['ACTIVE', 'CONSUMED', 'EXPIRED', 'CANCELLED']))])
    .transform((v) => (Array.isArray(v) ? v : [v]))
    .optional(),
  /** ACTIVE com validade vencida (overdue) ou vencendo nos próximos dias (expiring). */
  validity: z.enum(['overdue', 'expiring']).optional(),
  orderId: z.uuid().optional(),
  from: dateOnly.optional(),
  to: dateOnly.optional(),
});
export type ReleaseListQuery = z.infer<typeof releaseListQuerySchema>;

export interface ReleaseListItem extends ReleaseDto {
  order: { id: string; number: string; status: OrderStatus; version: number };
  farm: Ref | null;
  buyer: Ref | null;
  commodity: Ref | null;
  unit: string;
  /** Validade já passou e a liberação segue ativa. */
  overdue: boolean;
  /** Pode ser cancelada por quem consulta (permissão + status da liberação e da ordem). */
  cancellable: boolean;
}

export interface ReleasesSummary {
  active: number;
  expiring: number;
  overdue: number;
  cancelled: number;
  /** Quantidade ativa por unidade (ex.: { t: "1200.0000" }). */
  activeQtyByUnit: Record<string, string>;
}

export const orderListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(10).max(200).default(50),
  q: z.string().trim().max(120).optional(),
  status: z
    .union([z.enum(ORDER_STATUSES), z.array(z.enum(ORDER_STATUSES))])
    .transform((v) => (Array.isArray(v) ? v : [v]))
    .optional(),
  priority: z.enum(ORDER_PRIORITIES).optional(),
  commodityId: z.uuid().optional(),
  sellerPartnerId: z.uuid().optional(),
  buyerPartnerId: z.uuid().optional(),
  farmId: z.uuid().optional(),
  contractId: z.uuid().optional(),
  farmSignal: z.enum(['NEVER', 'CURRENT', 'OUTDATED', 'OVERDUE']).optional(),
  buyerSignal: z.enum(['NEVER', 'CURRENT', 'OUTDATED', 'OVERDUE']).optional(),
  from: dateOnly.optional(),
  to: dateOnly.optional(),
  sort: z
    .enum([
      'number:asc',
      'number:desc',
      'orderDate:asc',
      'orderDate:desc',
      'loadingStartsOn:asc',
      'loadingStartsOn:desc',
      'quantity:asc',
      'quantity:desc',
      'updatedAt:asc',
      'updatedAt:desc',
    ])
    .default('updatedAt:desc'),
});
export type OrderListQuery = z.infer<typeof orderListQuerySchema>;

export interface Ref {
  id: string;
  name: string;
}

export interface OrderQuantities {
  total: string;
  released: string;
  scheduled: string;
  loaded: string;
  inTransit: string;
  received: string;
  cancelled: string;
  balance: string;
  unit: string;
}

export interface ViewSignalInfo {
  signal: ViewSignal;
  lastViewedAt: string | null;
  lastViewedBy: string | null;
  viewedVersion: number | null;
}

export interface OrderListItem {
  id: string;
  number: string;
  externalNumber: string | null;
  orderDate: string | null;
  status: OrderStatus;
  priority: OrderPriority;
  version: number;
  commodity: Ref | null;
  seller: Ref | null;
  farm: (Ref & { city: string | null; state: string | null }) | null;
  buyer: Ref | null;
  contract: { id: string; number: string } | null;
  cropYear: string | null;
  quantities: OrderQuantities;
  totalValue: string | null;
  currency: string;
  /** Transporte digitado na ordem. */
  transport: TransportDto;
  loadingStartsOn: string | null;
  loadingEndsOn: string | null;
  farmView: ViewSignalInfo;
  buyerView: ViewSignalInfo;
  updatedAt: string;
  updatedBy: string | null;
  origin: OrderOrigin;
}

export interface OrderDetail extends OrderListItem {
  operationType: OperationType | null;
  unit: { id: string; code: string; name: string } | null;
  unitPrice: string | null;
  freightMode: FreightMode | null;
  freightEstimate: string | null;
  tolerancePct: string;
  requiresReceipt: boolean;
  loadingLocationName: string | null;
  loadingLocationAddress: string | null;
  loadingLocationCity: string | null;
  loadingLocationState: string | null;
  destinationName: string | null;
  destinationAddress: string | null;
  destinationCity: string | null;
  destinationState: string | null;
  commercialTerms: string | null;
  loadingInstructions: string | null;
  internalNotes: string | null;
  farmNotes: string | null;
  buyerNotes: string | null;
  initialReleaseQty: string | null;
  publishedAt: string | null;
  createdAt: string;
  createdBy: string | null;
  /** Envio do Comprador ao Faturamento. */
  submittedAt: string | null;
  submittedBy: string | null;
  /** Última devolução ao Comprador (visível à Matriz e ao Comprador). */
  returnedAt: string | null;
  returnedBy: string | null;
  returnReason: string | null;
  /** Cancelamento com motivo (solicitações do portal). */
  cancelledAt: string | null;
  cancelReason: string | null;
  /** Conclusão (Q45): automática ao encerrar as cargas ou informada pela Matriz. */
  completedAt: string | null;
  completedBy: string | null;
  completionReason: string | null;
  /** Suspensão vigente (status SUSPENDED). */
  suspendedAt: string | null;
  suspendReason: string | null;
  releases: ReleaseDto[];
  allowedActions: string[];
  /** Somente Matriz: fluxo de publicação (Q40). */
  workflow: OrderWorkflowInfo | null;
}

export interface OrderWorkflowInfo {
  publishRequestedAt: string | null;
  publishRequestedBy: string | null;
  /** A dupla checagem vale para esta ordem (empresa ativou e a quantidade atinge o mínimo). */
  fourEyesRequired: boolean;
  /** Quem consulta foi o último a editar e, com dupla checagem, não pode publicar. */
  blockedByFourEyes: boolean;
}

export const requestPublishSchema = z.object({
  expectedUpdatedAt: z.iso.datetime(),
});

export const workflowSettingsSchema = z.object({
  publishFourEyes: z.boolean(),
  publishFourEyesMinT: quantityString.nullable(),
});
export type WorkflowSettingsInput = z.infer<typeof workflowSettingsSchema>;
export type WorkflowSettingsDto = WorkflowSettingsInput;

export interface ReleaseDto {
  id: string;
  sequence: number;
  quantity: string;
  validUntil: string | null;
  status: ReleaseStatus;
  notes: string | null;
  orderVersion: number;
  createdAt: string;
  createdBy: string | null;
  cancelledAt: string | null;
  cancelledBy: string | null;
  cancelReason: string | null;
}

export interface OrderVersionDto {
  version: number;
  changedFields: { field: string; from: unknown; to: unknown }[];
  createdAt: string;
  createdBy: string | null;
}

export interface TimelineEventDto {
  id: string;
  at: string;
  action: string;
  label: string;
  actor: string | null;
  organization: string | null;
  context: Record<string, unknown> | null;
}

export interface OrderViewHistoryItem {
  organization: string;
  side: 'FARM' | 'BUYER';
  user: string;
  version: number;
  firstViewedAt: string;
  lastViewedAt: string;
  viewCount: number;
}

export interface OrdersSummary {
  open: number;
  draft: number;
  publishedToday: number;
  awaitingFarmView: number;
  awaitingBuyerView: number;
  totalQty: string;
  releasedQty: string;
  loadedQty: string;
  receivedQty: string;
  balanceQty: string;
}
