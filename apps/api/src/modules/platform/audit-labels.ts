import type { Tx } from '@ordens/db';

type Resolver = (tx: Tx, ids: string[]) => Promise<[string, string][]>;

/** Rótulo legível por tipo de entidade auditada (consultas em lote, sob a RLS de quem consulta). */
const RESOLVERS: Record<string, Resolver> = {
  loading_order: async (tx, ids) => (await tx.loadingOrder.findMany({ where: { id: { in: ids } }, select: { id: true, number: true } })).map((r) => [r.id, `OC ${r.number}`]),
  load: async (tx, ids) => (await tx.load.findMany({ where: { id: { in: ids } }, select: { id: true, number: true } })).map((r) => [r.id, `Carga ${r.number}`]),
  occurrence: async (tx, ids) => (await tx.occurrence.findMany({ where: { id: { in: ids } }, select: { id: true, number: true } })).map((r) => [r.id, r.number]),
  invoice: async (tx, ids) => (await tx.invoice.findMany({ where: { id: { in: ids } }, select: { id: true, number: true } })).map((r) => [r.id, r.number ? `NF-e ${r.number}` : 'NF-e']),
  support_conversation: async (tx, ids) => (await tx.supportConversation.findMany({ where: { id: { in: ids } }, select: { id: true, number: true } })).map((r) => [r.id, r.number]),
  user: async (tx, ids) => (await tx.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })).map((r) => [r.id, r.name]),
  membership: async (tx, ids) =>
    (await tx.membership.findMany({ where: { id: { in: ids } }, select: { id: true, user: { select: { name: true } } } })).map((r) => [r.id, r.user.name]),
  support_team: async (tx, ids) =>
    (await tx.membership.findMany({ where: { id: { in: ids } }, select: { id: true, user: { select: { name: true } } } })).map((r) => [r.id, r.user.name]),
  partner: async (tx, ids) =>
    (await tx.businessPartner.findMany({ where: { id: { in: ids } }, select: { id: true, legalName: true, tradeName: true } })).map((r) => [r.id, r.tradeName ?? r.legalName]),
  farm: async (tx, ids) => (await tx.farm.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })).map((r) => [r.id, r.name]),
  contract: async (tx, ids) => (await tx.contract.findMany({ where: { id: { in: ids } }, select: { id: true, number: true } })).map((r) => [r.id, `Contrato ${r.number}`]),
  commodity: async (tx, ids) => (await tx.commodity.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })).map((r) => [r.id, r.name]),
  driver: async (tx, ids) => (await tx.driver.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })).map((r) => [r.id, r.name]),
  vehicle: async (tx, ids) => (await tx.vehicle.findMany({ where: { id: { in: ids } }, select: { id: true, plate: true } })).map((r) => [r.id, r.plate]),
  file_upload: async (tx, ids) => (await tx.fileUpload.findMany({ where: { id: { in: ids } }, select: { id: true, originalName: true } })).map((r) => [r.id, r.originalName]),
  role: async (tx, ids) => (await tx.tenantRole.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })).map((r) => [r.id, r.name]),
};

/** Mapa "tipo:id" → rótulo para os eventos da página. Entidade apagada ou invisível fica sem rótulo. */
export async function resolveAuditLabels(tx: Tx, rows: { entityType: string; entityId: string | null }[]): Promise<Map<string, string>> {
  const byType = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!r.entityId || !RESOLVERS[r.entityType]) continue;
    if (!byType.has(r.entityType)) byType.set(r.entityType, new Set());
    byType.get(r.entityType)!.add(r.entityId);
  }
  const labels = new Map<string, string>();
  for (const [type, ids] of byType) {
    for (const [id, label] of await RESOLVERS[type]!(tx, [...ids])) labels.set(`${type}:${id}`, label);
  }
  return labels;
}
