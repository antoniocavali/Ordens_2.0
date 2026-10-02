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
      where: { entityType: 'load', entityId: { in: ids }, kind: { in: ['PDF', 'NFE_XML'] }, status: { notIn: ['ABORTED', 'EXPIRED', 'REMOVED'] } },
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
 * Q47: checklist da nota que a Matriz emite para o Comprador. Os documentos da Fazenda continuam valendo
 * para a etapa do carregamento; aqui contam só os da Matriz:
 * - o arquivo não foi enviado por uma organização Fazenda;
 * - o XML não é uma NF-e de origem FARM (a Matriz pode anexar a nota da Fazenda em nome dela);
 * - o arquivo foi anexado depois que a carga saiu para transporte — até ali a documentação exigida é a
 *   da Fazenda, então o que entra depois é a nota da Matriz.
 */
export async function matrizChecklists(
  tx: Tx,
  rows: Pick<LoadRow, 'id' | 'status'>[],
  force = false,
): Promise<Map<string, LoadFiscalChecklist>> {
  const target = rows.filter((r) => force || LOAD_MATRIZ_CHECK_STATUSES.includes(r.status));
  if (!target.length) return new Map();
  const ids = target.map((r) => r.id);
  const [transitStartedAt, uploads, invoices] = await Promise.all([
    tx.loadStatusHistory.findMany({
      where: { loadId: { in: ids }, toStatus: 'IN_TRANSIT' },
      select: { loadId: true, occurredAt: true },
      orderBy: { occurredAt: 'asc' },
    }),
    tx.fileUpload.findMany({
      where: { entityType: 'load', entityId: { in: ids }, kind: { in: ['PDF', 'NFE_XML'] }, status: { notIn: ['ABORTED', 'EXPIRED', 'REMOVED'] } },
      select: { id: true, entityId: true, kind: true, status: true, createdAt: true, organizationId: true },
    }),
    tx.invoice.findMany({ where: { loadId: { in: ids }, fileUploadId: { not: null } }, select: { loadId: true, fileUploadId: true, status: true, origin: true } }),
  ]);
  const farmOrgs = new Set(
    (
      await tx.organization.findMany({
        where: { id: { in: [...new Set(uploads.map((u) => u.organizationId))] }, kind: 'FARM' },
        select: { id: true },
      })
    ).map((o) => o.id),
  );
  const farmXml = new Set(invoices.filter((i) => i.origin === 'FARM').map((i) => i.fileUploadId));
  // Primeira saída para transporte (a lista vem ordenada por data).
  const since = new Map<string, Date>();
  for (const h of transitStartedAt) if (!since.has(h.loadId)) since.set(h.loadId, h.occurredAt);
  return new Map(
    target.map((r) => {
      const from = since.get(r.id);
      const own = uploads.filter((u) => {
        if (u.entityId !== r.id || farmOrgs.has(u.organizationId)) return false;
        if (u.kind === 'NFE_XML' && farmXml.has(u.id)) return false;
        return !from || u.createdAt >= from;
      });
      return [
        r.id,
        evaluateFiscalDocuments({
          party: 'MATRIZ',
          weighed: true,
          uploads: own,
          invoices: invoices.filter((i) => i.loadId === r.id && i.origin === 'MATRIZ'),
        }),
      ];
    }),
  );
}
