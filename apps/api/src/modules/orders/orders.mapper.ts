import type { OrderDetail, OrderListItem, ReleaseDto, Scope, ViewSignalInfo } from '@ordens/contracts';
import { Prisma } from '@ordens/db';
import type { OrderRow } from './orders.queries.js';

export const dec = (v: Prisma.Decimal | null | undefined): string | null => (v == null ? null : new Prisma.Decimal(v).toString());
export const day = (v: Date | null | undefined): string | null => (v ? v.toISOString().slice(0, 10) : null);
const iso = (v: Date | null | undefined): string | null => (v ? v.toISOString() : null);

function signal(row: OrderRow, side: 'FARM' | 'BUYER', scope: Scope): ViewSignalInfo {
  // Usuário externo só enxerga (via RLS) as visualizações da própria organização.
  if ((scope === 'FARM' && side === 'BUYER') || (scope === 'BUYER' && side === 'FARM')) {
    return { signal: 'NO_PORTAL', lastViewedAt: null, lastViewedBy: null, viewedVersion: null };
  }
  const p = side === 'FARM' ? 'farm' : 'buyer';
  return {
    signal: row[`${p}_signal`] as ViewSignalInfo['signal'],
    lastViewedAt: iso(row[`${p}_viewed_at`]),
    lastViewedBy: row[`${p}_viewed_by`],
    viewedVersion: row[`${p}_viewed_version`],
  };
}

export function toListItem(row: OrderRow, scope: Scope): OrderListItem {
  const qty = row.quantity ? new Prisma.Decimal(row.quantity) : null;
  const loaded = new Prisma.Decimal(row.loaded_qty);
  const cancelled = new Prisma.Decimal(row.cancelled_qty);
  const balance = qty ? Prisma.Decimal.max(qty.minus(loaded).minus(cancelled), 0) : new Prisma.Decimal(0);
  const hidePrices = scope === 'BUYER';
  const totalValue = !hidePrices && qty && row.unit_price ? qty.times(row.unit_price).toDecimalPlaces(2).toFixed(2) : null;

  return {
    id: row.id,
    number: row.number,
    externalNumber: row.external_number,
    orderDate: day(row.order_date),
    status: row.status as OrderListItem['status'],
    priority: row.priority as OrderListItem['priority'],
    version: row.version,
    commodity: row.commodity_id ? { id: row.commodity_id, name: row.commodity_name ?? '' } : null,
    seller: row.seller_partner_id ? { id: row.seller_partner_id, name: row.seller_name ?? '' } : null,
    farm: row.farm_id ? { id: row.farm_id, name: row.farm_name ?? '', city: row.farm_city, state: row.farm_state } : null,
    buyer: row.buyer_partner_id ? { id: row.buyer_partner_id, name: row.buyer_name ?? '' } : null,
    contract: row.contract_id ? { id: row.contract_id, number: row.contract_number ?? '' } : null,
    cropYear: row.crop_year,
    quantities: {
      total: dec(row.quantity) ?? '0',
      released: dec(row.released_qty)!,
      scheduled: dec(row.scheduled_qty)!,
      loaded: dec(row.loaded_qty)!,
      inTransit: dec(row.in_transit_qty)!,
      received: dec(row.received_qty)!,
      cancelled: dec(row.cancelled_qty)!,
      balance: balance.toString(),
      unit: row.unit_code === 'T' ? 't' : (row.unit_code?.toLowerCase() ?? ''),
    },
    totalValue,
    currency: row.currency,
    preferredCarrierName: row.preferred_carrier_name,
    loadingStartsOn: day(row.loading_starts_on),
    loadingEndsOn: day(row.loading_ends_on),
    farmView: signal(row, 'FARM', scope),
    buyerView: signal(row, 'BUYER', scope),
    updatedAt: row.updated_at.toISOString(),
    updatedBy: row.updated_by_name,
    origin: row.origin as OrderListItem['origin'],
  };
}

export function toDetail(row: OrderRow, releases: ReleaseDto[], scope: Scope, allowedActions: string[]): OrderDetail {
  const internal = scope === 'MATRIZ';
  return {
    ...toListItem(row, scope),
    operationType: row.operation_type as OrderDetail['operationType'],
    unit: row.unit_id ? { id: row.unit_id, code: row.unit_code ?? '', name: row.unit_name ?? '' } : null,
    unitPrice: scope === 'BUYER' ? null : dec(row.unit_price),
    freightMode: row.freight_mode as OrderDetail['freightMode'],
    freightEstimate: scope === 'BUYER' ? null : dec(row.freight_estimate),
    tolerancePct: dec(row.tolerance_pct) ?? '0',
    requiresReceipt: row.requires_receipt,
    loadingLocationName: row.loading_location_name,
    loadingLocationAddress: row.loading_location_address,
    loadingLocationCity: row.loading_location_city,
    loadingLocationState: row.loading_location_state,
    destinationName: row.destination_name,
    destinationAddress: row.destination_address,
    destinationCity: row.destination_city,
    destinationState: row.destination_state,
    commercialTerms: row.commercial_terms,
    loadingInstructions: row.loading_instructions,
    internalNotes: internal ? row.internal_notes : null,
    farmNotes: scope === 'BUYER' ? null : row.farm_notes,
    buyerNotes: scope === 'FARM' ? null : row.buyer_notes,
    initialReleaseQty: internal ? dec(row.initial_release_qty) : null,
    publishedAt: iso(row.published_at),
    createdAt: row.created_at.toISOString(),
    createdBy: row.created_by_name,
    submittedAt: iso(row.submitted_at),
    submittedBy: row.submitted_by_name,
    // A Fazenda nunca enxerga solicitações não publicadas; devolução e cancelamento ficam com Matriz e Comprador.
    returnedAt: scope === 'FARM' ? null : iso(row.returned_at),
    returnedBy: scope === 'FARM' ? null : row.returned_by_name,
    returnReason: scope === 'FARM' ? null : row.return_reason,
    cancelledAt: iso(row.cancelled_at),
    // Motivos de cancelamento e suspensão de ordem publicada são compartilhados com as partes.
    cancelReason: row.cancel_reason,
    completedAt: iso(row.completed_at),
    completedBy: row.completed_by_name,
    completionReason: row.completion_reason,
    suspendedAt: row.status === 'SUSPENDED' ? iso(row.suspended_at) : null,
    suspendReason: row.status === 'SUSPENDED' ? row.suspend_reason : null,
    releases,
    allowedActions,
  } as OrderDetail;
}
