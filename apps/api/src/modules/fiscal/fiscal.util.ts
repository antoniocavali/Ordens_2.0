import {
  OCCURRENCE_TYPE_LABELS,
  type DocumentVisibility,
  type OccurrenceSeverity,
  type OccurrenceType,
} from '@ordens/contracts';
import { nextSequence, type Tx, type UnitOfWorkScope } from '@ordens/db';

/** Filtra valores de query para um enum conhecido (evita erro do banco com valores livres). */
export function oneOf<T extends string>(values: readonly T[], input?: string[]): T[] | undefined {
  return input?.filter((v): v is T => (values as readonly string[]).includes(v));
}

export const uniq = <T>(values: (T | null | undefined)[]): T[] => [...new Set(values.filter((v): v is T => v !== null && v !== undefined))];

export const decimal = (v: { toString(): string } | null | undefined) => (v === null || v === undefined ? null : v.toString());

async function nextOccurrenceNumber(tx: Tx, tenantId: string) {
  const year = new Date().getUTCFullYear();
  const seq = await nextSequence(tx, tenantId, 'occurrence', year);
  return `OCR-${year}-${String(seq).padStart(4, '0')}`;
}

export interface OpenOccurrenceInput {
  tenantId: string;
  orderId: string;
  loadId: string | null;
  type: OccurrenceType;
  severity: OccurrenceSeverity;
  title: string;
  description: string | null;
  visibility: DocumentVisibility;
  responsibleUserId: string | null;
  dueOn: Date | null;
  source: 'MANUAL' | 'SYSTEM';
  createdBy: string | null;
}

/** Abre ocorrência com número sequencial, auditoria e outbox na unidade de trabalho corrente. */
export async function openOccurrence(scope: UnitOfWorkScope, input: OpenOccurrenceInput) {
  const { tx, audit, outbox } = scope;
  const number = await nextOccurrenceNumber(tx, input.tenantId);
  const row = await tx.occurrence.create({ data: { ...input, number } });
  await audit({
    entityType: 'occurrence',
    entityId: row.id,
    action: 'occurrence.opened',
    after: { number, type: input.type, severity: input.severity, title: input.title, visibility: input.visibility, source: input.source, loadId: input.loadId },
  });
  await audit({
    entityType: 'loading_order',
    entityId: input.orderId,
    action: 'order.occurrence_opened',
    after: { occurrenceNumber: number, title: input.title, typeLabel: OCCURRENCE_TYPE_LABELS[input.type], visibility: input.visibility, source: input.source },
  });
  await outbox({
    type: 'occurrence.opened',
    aggregateType: 'occurrence',
    aggregateId: row.id,
    payload: { occurrenceId: row.id, orderId: input.orderId, loadId: input.loadId, severity: input.severity, source: input.source },
  });
  return row;
}
