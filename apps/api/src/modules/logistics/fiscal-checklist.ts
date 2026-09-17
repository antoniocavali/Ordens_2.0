import { evaluateFiscalDocuments, LOAD_FISCAL_CHECK_STATUSES, type LoadFiscalChecklist } from '@ordens/contracts';
import type { Tx } from '@ordens/db';

type LoadRow = NonNullable<Awaited<ReturnType<Tx['load']['findUnique']>>>;

/** Checklist de pesagem e documentos fiscais por carga (uma consulta por tipo, sem N+1). */
export async function fiscalChecklists(
  tx: Tx,
  rows: Pick<LoadRow, 'id' | 'status' | 'grossKg' | 'tareKg'>[],
  force = false,
): Promise<Map<string, LoadFiscalChecklist>> {
  const target = rows.filter((r) => force || LOAD_FISCAL_CHECK_STATUSES.includes(r.status));
  if (!target.length) return new Map();
  const ids = target.map((r) => r.id);
  const [uploads, invoices] = await Promise.all([
    tx.fileUpload.findMany({
      where: { entityType: 'load', entityId: { in: ids }, kind: { in: ['PDF', 'NFE_XML'] }, status: { notIn: ['ABORTED', 'EXPIRED'] } },
      select: { id: true, entityId: true, kind: true, status: true, createdAt: true },
    }),
    tx.invoice.findMany({ where: { loadId: { in: ids }, fileUploadId: { not: null } }, select: { loadId: true, fileUploadId: true, status: true } }),
  ]);
  return new Map(
    target.map((r) => [
      r.id,
      evaluateFiscalDocuments({
        weighed: Boolean(r.grossKg && r.tareKg),
        uploads: uploads.filter((u) => u.entityId === r.id),
        invoices: invoices.filter((i) => i.loadId === r.id),
      }),
    ]),
  );
}
