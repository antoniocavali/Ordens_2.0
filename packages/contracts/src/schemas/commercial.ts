import { z } from 'zod';
import { priceString, quantityString } from '../decimal.js';
import { FREIGHT_MODES, type FreightMode } from '../enums.js';

export const CONTRACT_STATUSES = ['DRAFT', 'ACTIVE', 'CLOSED', 'CANCELLED'] as const;
export type ContractStatus = (typeof CONTRACT_STATUSES)[number];

export const CONTRACT_STATUS_LABELS: Record<ContractStatus, string> = {
  DRAFT: 'Rascunho',
  ACTIVE: 'Ativo',
  CLOSED: 'Encerrado',
  CANCELLED: 'Cancelado',
};

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v))
    .nullish();
const dateOnly = z
  .union([z.literal(''), z.iso.date()])
  .transform((v) => (v === '' ? null : v))
  .nullish();

export const contractInputSchema = z
  .object({
    number: z
      .string()
      .trim()
      .max(40)
      .transform((v) => (v === '' ? null : v.toUpperCase()))
      .nullish(),
    sellerPartnerId: z.uuid('Selecione o vendedor'),
    buyerPartnerId: z.uuid('Selecione o comprador'),
    commodityId: z.uuid('Selecione a commodity'),
    cropYear: z
      .union([z.literal(''), z.string().regex(/^\d{2}\/\d{2}$|^\d{4}$/, 'Safra no formato 25/26 ou 2026')])
      .transform((v) => (v === '' ? null : v))
      .nullish(),
    quantity: quantityString,
    unitId: z.uuid('Selecione a unidade'),
    unitPrice: priceString.or(z.literal('').transform(() => null)).nullish(),
    currency: z.enum(['BRL', 'USD']).default('BRL'),
    startsOn: dateOnly,
    endsOn: dateOnly,
    freightMode: z
      .union([z.literal(''), z.enum(FREIGHT_MODES)])
      .transform((v) => (v === '' ? null : v))
      .nullish(),
    terms: text(4000),
    notes: text(4000),
    status: z.enum(CONTRACT_STATUSES).default('ACTIVE'),
  })
  .refine((v) => !v.startsOn || !v.endsOn || v.startsOn <= v.endsOn, { message: 'A data final deve ser posterior à inicial', path: ['endsOn'] })
  .refine((v) => v.sellerPartnerId !== v.buyerPartnerId, { message: 'Vendedor e comprador devem ser diferentes', path: ['buyerPartnerId'] });
export type ContractInput = z.input<typeof contractInputSchema>;

export interface ContractBalances {
  contracted: string;
  committed: string;
  released: string;
  loaded: string;
  received: string;
  balance: string;
  totalValue: string | null;
  committedValue: string | null;
  valueBalance: string | null;
}

export interface ContractListItem {
  id: string;
  number: string;
  status: ContractStatus;
  seller: { id: string; name: string };
  buyer: { id: string; name: string };
  commodity: { id: string; name: string };
  cropYear: string | null;
  unit: { id: string; code: string };
  unitPrice: string | null;
  currency: string;
  freightMode: FreightMode | null;
  startsOn: string | null;
  endsOn: string | null;
  ordersCount: number;
  balances: ContractBalances;
  updatedAt: string;
}

export interface ContractDetail extends ContractListItem {
  terms: string | null;
  notes: string | null;
  orders: { id: string; number: string; status: string; quantity: string | null; loaded: string; createdAt: string }[];
  createdAt: string;
}
