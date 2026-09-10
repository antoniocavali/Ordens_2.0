import { z } from 'zod';
import { quantityString } from '../decimal.js';
import { LOAD_STATUSES, type LoadStatus } from '../enums.js';

export const APPOINTMENT_STATUSES = ['REQUESTED', 'CONFIRMED', 'CHECKED_IN', 'CONVERTED', 'CANCELLED', 'NO_SHOW'] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

export const APPOINTMENT_STATUS_LABELS: Record<AppointmentStatus, string> = {
  REQUESTED: 'Solicitado',
  CONFIRMED: 'Confirmado',
  CHECKED_IN: 'Chegou na fazenda',
  CONVERTED: 'Virou carga',
  CANCELLED: 'Cancelado',
  NO_SHOW: 'Não compareceu',
};

export const APPOINTMENT_TRANSITIONS: Record<AppointmentStatus, readonly AppointmentStatus[]> = {
  REQUESTED: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['CHECKED_IN', 'CANCELLED', 'NO_SHOW'],
  CHECKED_IN: ['CONVERTED', 'CANCELLED'],
  CONVERTED: [],
  CANCELLED: [],
  NO_SHOW: [],
};

/** Status de carga que ainda contam como "agendado" (antes de sair carregada). */
export const LOAD_PRE_LOADED: readonly LoadStatus[] = ['SCHEDULED', 'CONFIRMED', 'AWAITING_LOADING', 'LOADING', 'AWAITING_FARM_INVOICE', 'FARM_INVOICED'];
/** Status em que a carga já saiu carregada (conta em "carregado"). */
export const LOAD_LOADED: readonly LoadStatus[] = ['LOADED', 'IN_TRANSIT', 'ARRIVED', 'RECEIVED', 'CHECKED', 'AWAITING_MATRIZ_INVOICE', 'MATRIZ_INVOICED', 'COMPLETED'];
export const LOAD_IN_TRANSIT: readonly LoadStatus[] = ['IN_TRANSIT', 'ARRIVED'];
export const LOAD_RECEIVED: readonly LoadStatus[] = ['RECEIVED', 'CHECKED', 'AWAITING_MATRIZ_INVOICE', 'MATRIZ_INVOICED', 'COMPLETED'];

/** Macro-etapas para visualização (kanban/stepper). */
export const LOAD_STAGES = [
  { key: 'scheduling', label: 'Agendamento', statuses: ['SCHEDULED', 'CONFIRMED', 'AWAITING_LOADING'] },
  { key: 'loading', label: 'Carregamento', statuses: ['LOADING', 'AWAITING_FARM_INVOICE', 'FARM_INVOICED', 'LOADED'] },
  { key: 'transit', label: 'Transporte', statuses: ['IN_TRANSIT', 'ARRIVED'] },
  { key: 'receiving', label: 'Recebimento', statuses: ['RECEIVED', 'CHECKED'] },
  { key: 'billing', label: 'Faturamento', statuses: ['AWAITING_MATRIZ_INVOICE', 'MATRIZ_INVOICED', 'COMPLETED'] },
] as const satisfies readonly { key: string; label: string; statuses: readonly LoadStatus[] }[];

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v))
    .nullish();
const optQty = quantityString.or(z.literal('').transform(() => null)).nullish();

const fleet = {
  carrierPartnerId: z.uuid().nullish(),
  driverId: z.uuid().nullish(),
  tractorVehicleId: z.uuid().nullish(),
  trailerVehicleId: z.uuid().nullish(),
  secondTrailerVehicleId: z.uuid().nullish(),
};

export const appointmentInputSchema = z
  .object({
    orderId: z.uuid(),
    scheduledOn: z.iso.date('Informe a data'),
    windowStart: z
      .union([z.literal(''), z.string().regex(/^\d{2}:\d{2}$/)])
      .transform((v) => (v === '' ? null : v))
      .nullish(),
    windowEnd: z
      .union([z.literal(''), z.string().regex(/^\d{2}:\d{2}$/)])
      .transform((v) => (v === '' ? null : v))
      .nullish(),
    expectedQty: quantityString,
    ...fleet,
    notes: text(2000),
  })
  .refine((v) => !v.windowStart || !v.windowEnd || v.windowStart < v.windowEnd, { message: 'Horário final deve ser após o inicial', path: ['windowEnd'] });
export type AppointmentInput = z.input<typeof appointmentInputSchema>;

export const appointmentTransitionSchema = z.object({
  to: z.enum(APPOINTMENT_STATUSES),
  reason: text(500),
});

export const loadInputSchema = z.object({
  orderId: z.uuid(),
  appointmentId: z.uuid().nullish(),
  loadingDate: z
    .union([z.literal(''), z.iso.date()])
    .transform((v) => (v === '' ? null : v))
    .nullish(),
  expectedQty: quantityString,
  ...fleet,
  notes: text(2000),
});
export type LoadInput = z.input<typeof loadInputSchema>;

export const loadUpdateSchema = z.object({
  expectedUpdatedAt: z.iso.datetime(),
  loadingDate: loadInputSchema.shape.loadingDate,
  ...fleet,
  grossKg: optQty,
  tareKg: optQty,
  invoicedQty: optQty,
  receivedQty: optQty,
  notes: text(2000),
});
export type LoadUpdateInput = z.input<typeof loadUpdateSchema>;

export const loadTransitionSchema = z.object({
  to: z.enum(LOAD_STATUSES),
  expectedUpdatedAt: z.iso.datetime(),
  notes: text(500),
  /** Pesagem/recebimento podem ser informados na própria transição. */
  grossKg: optQty,
  tareKg: optQty,
  receivedQty: optQty,
});
export type LoadTransitionInput = z.input<typeof loadTransitionSchema>;

export const logisticsListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(10).max(200).default(50),
  q: z.string().trim().max(120).optional(),
  orderId: z.uuid().optional(),
  status: z
    .union([z.string(), z.array(z.string())])
    .transform((v) => (Array.isArray(v) ? v : [v]))
    .optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  carrierPartnerId: z.uuid().optional(),
});
export type LogisticsListQuery = z.infer<typeof logisticsListQuery>;

export interface FleetRefs {
  carrier: { id: string; name: string } | null;
  driver: { id: string; name: string; cnhStatus?: string } | null;
  tractor: { id: string; plate: string } | null;
  trailer: { id: string; plate: string } | null;
  secondTrailer: { id: string; plate: string } | null;
  plates: string[];
}

export interface AppointmentDto extends FleetRefs {
  id: string;
  order: { id: string; number: string; commodity: string | null; farm: string | null; unit: string };
  scheduledOn: string;
  windowStart: string | null;
  windowEnd: string | null;
  expectedQty: string;
  status: AppointmentStatus;
  loadId: string | null;
  notes: string | null;
  createdBy: string | null;
  updatedAt: string;
  allowedTransitions: AppointmentStatus[];
}

export interface LoadDto extends FleetRefs {
  id: string;
  number: string;
  order: { id: string; number: string; commodity: string | null; farm: string | null; buyer: string | null; unit: string };
  appointmentId: string | null;
  loadingDate: string | null;
  expectedQty: string;
  grossKg: string | null;
  tareKg: string | null;
  netKg: string | null;
  invoicedQty: string | null;
  receivedQty: string | null;
  divergenceKg: string | null;
  status: LoadStatus;
  notes: string | null;
  updatedAt: string;
  allowedTransitions: LoadStatus[];
}

export interface LoadHistoryItem {
  id: string;
  from: LoadStatus | null;
  to: LoadStatus;
  actor: string | null;
  notes: string | null;
  occurredAt: string;
}

export interface LogisticsSummary {
  appointmentsToday: number;
  appointmentsWithoutCarrier: number;
  loadsByStage: Record<(typeof LOAD_STAGES)[number]['key'], number>;
  inTransitKg: string;
  lateLoads: number;
}
