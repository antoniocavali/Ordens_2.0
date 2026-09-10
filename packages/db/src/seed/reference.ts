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
    await tx.permission.deleteMany({ where: { code: { notIn: Object.keys(PERMISSIONS) } } });
  });
}
