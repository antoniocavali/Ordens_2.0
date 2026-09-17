import { evaluateFiscalDocuments, LOAD_FISCAL_CHECK_STATUSES, LOAD_MATRIZ_CHECK_STATUSES, type LoadFiscalChecklist } from '@ordens/contracts';
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

/**
 * Q47: checklist da nota que a Matriz emite para o Comprador. Conta apenas documentos anexados a partir
 * do momento em que a carga entrou no faturamento da Matriz (`AWAITING_MATRIZ_INVOICE`) e notas com
 * origem MATRIZ — os documentos da Fazenda continuam valendo para a etapa do carregamento.
 */
export async function matrizChecklists(
  tx: Tx,
  rows: Pick<LoadRow, 'id' | 'status'>[],
  force = false,
): Promise<Map<string, LoadFiscalChecklist>> {
  const target = rows.filter((r) => force || LOAD_MATRIZ_CHECK_STATUSES.includes(r.status));
  if (!target.length) return new Map();
  const ids = target.map((r) => r.id);
  const [billingStartedAt, uploads, invoices] = await Promise.all([
    tx.loadStatusHistory.findMany({
      where: { loadId: { in: ids }, toStatus: 'AWAITING_MATRIZ_INVOICE' },
      select: { loadId: true, occurredAt: true },
      orderBy: { occurredAt: 'asc' },
    }),
    tx.fileUpload.findMany({
      where: { entityType: 'load', entityId: { in: ids }, kind: { in: ['PDF', 'NFE_XML'] }, status: { notIn: ['ABORTED', 'EXPIRED'] } },
      select: { id: true, entityId: true, kind: true, status: true, createdAt: true },
    }),
    tx.invoice.findMany({ where: { loadId: { in: ids }, origin: 'MATRIZ', fileUploadId: { not: null } }, select: { loadId: true, fileUploadId: true, status: true } }),
  ]);
  // Primeira entrada no faturamento da Matriz (a lista vem ordenada por data).
  const since = new Map<string, Date>();
  for (const h of billingStartedAt) if (!since.has(h.loadId)) since.set(h.loadId, h.occurredAt);
  return new Map(
    target.map((r) => {
      const from = since.get(r.id);
      const own = uploads.filter((u) => u.entityId === r.id && (!from || u.createdAt >= from));
      return [
        r.id,
        evaluateFiscalDocuments({
          party: 'MATRIZ',
          weighed: true,
          uploads: own,
          invoices: invoices.filter((i) => i.loadId === r.id),
        }),
      ];
    }),
  );
}
