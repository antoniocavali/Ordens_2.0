import { z } from 'zod';
import { isValidCnpj, isValidCpf, onlyDigits, UF } from '../documents.js';
import { decimalString, quantityString } from '../decimal.js';
import { PARTNER_ROLES, type PartnerRole, type RecordStatus } from '../enums.js';

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v))
    .nullish();
const email = z
  .union([z.literal(''), z.email('E-mail inválido').max(254)])
  .transform((v) => (v === '' ? null : v.toLowerCase()))
  .nullish();
const phone = z
  .string()
  .trim()
  .transform((v) => onlyDigits(v))
  .refine((v) => v === '' || (v.length >= 10 && v.length <= 13), 'Telefone inválido')
  .transform((v) => (v === '' ? null : v))
  .nullish();
const uf = z
  .union([z.literal(''), z.enum(UF)])
  .transform((v) => (v === '' ? null : v))
  .nullish();
const dateOnly = z
  .union([z.literal(''), z.iso.date()])
  .transform((v) => (v === '' ? null : v))
  .nullish();
const status = z.enum(['ACTIVE', 'INACTIVE', 'BLOCKED']).default('ACTIVE');

export const PARTNER_ROLE_LABELS: Record<PartnerRole, string> = {
  BUYER: 'Comprador',
  SELLER: 'Vendedor',
  PRODUCER: 'Produtor',
  COOPERATIVE_MEMBER: 'Cooperado',
  COOPERATIVE: 'Cooperativa',
  CARRIER: 'Transportadora',
  OTHER: 'Outro',
};

export const registryListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(10).max(200).default(50),
  q: z.string().trim().max(120).optional(),
  status: z.enum(['ACTIVE', 'INACTIVE', 'BLOCKED']).optional(),
  role: z.enum(PARTNER_ROLES).optional(),
  partnerId: z.uuid().optional(),
  includeArchived: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});
export type RegistryListQuery = z.infer<typeof registryListQuery>;

// ───────────────────────────── Parceiros ─────────────────────────────

export const partnerContactSchema = z.object({
  name: z.string().trim().min(2, 'Informe o nome').max(120),
  role: text(80),
  phone,
  email,
  isPrimary: z.boolean().default(false),
});

export const carrierProfileSchema = z.object({
  rntrc: z
    .string()
    .trim()
    .transform(onlyDigits)
    .refine((v) => v === '' || (v.length >= 8 && v.length <= 9), 'RNTRC deve ter 8 ou 9 dígitos')
    .transform((v) => (v === '' ? null : v))
    .nullish(),
  rntrcExpiresAt: dateOnly,
  opsContactName: text(120),
  opsContactPhone: phone,
  opsContactEmail: email,
});

export const partnerInputSchema = z
  .object({
    personType: z.enum(['PF', 'PJ']),
    legalName: z.string().trim().min(2, 'Informe a razão social ou nome').max(200),
    tradeName: text(200),
    document: z.string().trim().transform(onlyDigits),
    stateRegistration: text(30),
    email,
    phone,
    zipCode: z
      .string()
      .trim()
      .transform(onlyDigits)
      .refine((v) => v === '' || v.length === 8, 'CEP deve ter 8 dígitos')
      .transform((v) => (v === '' ? null : v))
      .nullish(),
    address: text(255),
    city: text(120),
    state: uf,
    notes: text(4000),
    status,
    roles: z.array(z.enum(PARTNER_ROLES)).min(1, 'Selecione ao menos um papel'),
    contacts: z.array(partnerContactSchema).max(20).default([]),
    carrierProfile: carrierProfileSchema.nullish(),
  })
  .superRefine((v, ctx) => {
    const valid = v.personType === 'PF' ? isValidCpf(v.document) : isValidCnpj(v.document);
    if (!valid) ctx.addIssue({ code: 'custom', path: ['document'], message: v.personType === 'PF' ? 'CPF inválido' : 'CNPJ inválido' });
  });
export type PartnerInput = z.input<typeof partnerInputSchema>;

export interface PartnerListItem {
  id: string;
  personType: 'PF' | 'PJ';
  legalName: string;
  tradeName: string | null;
  document: string;
  roles: PartnerRole[];
  city: string | null;
  state: string | null;
  email: string | null;
  phone: string | null;
  status: RecordStatus;
  farmsCount: number;
  ordersCount: number;
  openQuantity: string;
  hasPortal: boolean;
  archived: boolean;
  updatedAt: string;
}

export interface PartnerDetail extends PartnerListItem {
  stateRegistration: string | null;
  zipCode: string | null;
  address: string | null;
  notes: string | null;
  contacts: { id: string; name: string; role: string | null; phone: string | null; email: string | null; isPrimary: boolean }[];
  carrierProfile: { rntrc: string | null; rntrcExpiresAt: string | null; opsContactName: string | null; opsContactPhone: string | null; opsContactEmail: string | null } | null;
  farms: { id: string; name: string; city: string | null; state: string | null; status: RecordStatus }[];
  contractsCount: number;
  createdAt: string;
}

// ───────────────────────────── Fazendas ─────────────────────────────

export const farmInputSchema = z.object({
  ownerPartnerId: z.uuid('Selecione o vendedor/proprietário'),
  name: z.string().trim().min(2, 'Informe o nome da propriedade').max(160),
  code: text(40),
  stateRegistration: text(30),
  zipCode: z
    .string()
    .trim()
    .transform(onlyDigits)
    .refine((v) => v === '' || v.length === 8, 'CEP deve ter 8 dígitos')
    .transform((v) => (v === '' ? null : v))
    .nullish(),
  address: text(255),
  city: text(120),
  state: uf,
  latitude: decimalString({ scale: 6, allowNegative: true })
    .refine((v) => Math.abs(Number(v)) <= 90, 'Latitude inválida')
    .or(z.literal('').transform(() => null))
    .nullish(),
  longitude: decimalString({ scale: 6, allowNegative: true })
    .refine((v) => Math.abs(Number(v)) <= 180, 'Longitude inválida')
    .or(z.literal('').transform(() => null))
    .nullish(),
  loadingPoint: text(200),
  operatingHours: text(200),
  dailyCapacity: quantityString.or(z.literal('').transform(() => null)).nullish(),
  accessRestrictions: text(2000),
  carrierInstructions: text(2000),
  contactName: text(120),
  contactPhone: phone,
  notes: text(4000),
  status,
});
export type FarmInput = z.input<typeof farmInputSchema>;

export interface FarmListItem {
  id: string;
  name: string;
  code: string | null;
  owner: { id: string; name: string };
  city: string | null;
  state: string | null;
  loadingPoint: string | null;
  dailyCapacity: string | null;
  hasCoordinates: boolean;
  ordersCount: number;
  openQuantity: string;
  status: RecordStatus;
  updatedAt: string;
}

export interface FarmDetail extends FarmListItem {
  stateRegistration: string | null;
  zipCode: string | null;
  address: string | null;
  latitude: string | null;
  longitude: string | null;
  operatingHours: string | null;
  accessRestrictions: string | null;
  carrierInstructions: string | null;
  contactName: string | null;
  contactPhone: string | null;
  notes: string | null;
}

// ───────────────────────────── Commodities ─────────────────────────────

export const commodityInputSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9_-]{2,20}$/, 'Código: 2 a 20 letras, números, _ ou -'),
  name: z.string().trim().min(2).max(120),
  category: text(80),
  defaultUnitId: z.uuid().nullish(),
  description: text(1000),
  status,
});
export type CommodityInput = z.input<typeof commodityInputSchema>;

export interface CommodityListItem {
  id: string;
  code: string;
  name: string;
  category: string | null;
  defaultUnit: { id: string; code: string } | null;
  description: string | null;
  ordersCount: number;
  status: RecordStatus;
  updatedAt: string;
}
