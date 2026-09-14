import type { Tx } from './client.js';

/**
 * Permissões além dos papéis do sistema, por acesso: papéis personalizados ativos (Q35)
 * e concessões individuais (Q34). Combine com `effectivePermissions` do contracts.
 */
export async function extraPermissionsByMembership(tx: Tx, membershipIds: readonly string[]): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>(membershipIds.map((id) => [id, []]));
  if (!membershipIds.length) return map;
  const ids = [...membershipIds];
  const custom = await tx.membershipCustomRole.findMany({
    where: { membershipId: { in: ids }, role: { status: 'ACTIVE' } },
    select: { membershipId: true, role: { select: { permissions: { select: { permissionCode: true } } } } },
  });
  const grants = await tx.membershipPermissionGrant.findMany({ where: { membershipId: { in: ids } }, select: { membershipId: true, permissionCode: true } });
  for (const c of custom) map.get(c.membershipId)?.push(...c.role.permissions.map((p) => p.permissionCode));
  for (const g of grants) map.get(g.membershipId)?.push(g.permissionCode);
  return map;
}
