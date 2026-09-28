import { PERMISSIONS, ROLES } from '@ordens/contracts';
import type { PrismaClient } from '../generated/prisma/client.js';

/**
 * Dados de referência globais (idempotente, todos os ambientes):
 * catálogo de permissões, papéis e vínculos papel→permissão.
 * roles/permissions não possuem RLS e só são graváveis pelo owner (job de migration).
 */
export async function syncReference(prisma: PrismaClient): Promise<void> {
  await prisma.$transaction(async (tx) => {
    for (const [code, description] of Object.entries(PERMISSIONS)) {
      await tx.permission.upsert({ where: { code }, create: { code, description }, update: { description } });
    }
    for (const [code, role] of Object.entries(ROLES)) {
      await tx.role.upsert({
        where: { code },
        create: { code, name: role.name, scope: role.scope },
        update: { name: role.name, scope: role.scope },
      });
      await tx.rolePermission.deleteMany({
        where: { roleCode: code, permissionCode: { notIn: [...role.permissions] } },
      });
      await tx.rolePermission.createMany({
        data: role.permissions.map((permissionCode) => ({ roleCode: code, permissionCode })),
        skipDuplicates: true,
      });
    }
    // Permissões que saíram do catálogo levam junto os vínculos que as citam. Papéis personalizados
    // do tenant e concessões individuais não têm cascade no banco de propósito (apagar um papel não
    // pode apagar permissão), então precisam ser limpos aqui — senão a chave estrangeira derruba a
    // sincronização inteira e nenhuma permissão nova entra.
    //
    // As duas tabelas têm FORCE RLS, que vale inclusive para o dono: sem contexto de sessão o DELETE
    // não apagaria nada e o erro só apareceria na remoção da permissão. Este job é manutenção do
    // catálogo global, feita pelo dono fora de qualquer tenant, então a proteção é suspensa apenas
    // aqui dentro — o DDL é transacional, e um erro reverte tudo junto.
    const codes = Object.keys(PERMISSIONS);
    await tx.$executeRaw`alter table tenant_role_permissions no force row level security`;
    await tx.$executeRaw`alter table membership_permission_grants no force row level security`;
    try {
      const tenantRoles = await tx.tenantRolePermission.deleteMany({ where: { permissionCode: { notIn: codes } } });
      const grants = await tx.membershipPermissionGrant.deleteMany({ where: { permissionCode: { notIn: codes } } });
      const removed = await tx.permission.deleteMany({ where: { code: { notIn: codes } } });
      if (removed.count) {
        console.warn(
          `[seed] ${removed.count} permissão(ões) fora do catálogo removida(s)` +
            ` (${tenantRoles.count} vínculo(s) em papéis personalizados e ${grants.count} concessão(ões) individual(is)).`,
        );
      }
    } finally {
      await tx.$executeRaw`alter table tenant_role_permissions force row level security`;
      await tx.$executeRaw`alter table membership_permission_grants force row level security`;
    }
  });
}
