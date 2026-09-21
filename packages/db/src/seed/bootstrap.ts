/* eslint-disable no-console -- ferramenta de linha de comando: a saída no terminal é o resultado */
import { randomBytes, randomUUID } from 'node:crypto';
import { CRITICAL_2FA_ROLES, PASSWORD_MIN_LENGTH } from '@ordens/contracts';
import { Database } from '../client.js';
import { systemContext } from '../context.js';
import { hashPassword } from '../password.js';
import { EMPTY_META, writeAudit } from '../unit-of-work.js';

/**
 * Primeira empresa e primeiro Administrador Matriz de um ambiente novo (produção não tem seed demo).
 * Idempotente: se a empresa (slug) já existe, não faz nada. Rodar uma vez, depois das migrations:
 *
 *   docker compose -f docker-compose.prod.yml run --rm -e BOOTSTRAP_ADMIN_EMAIL=... \
 *     -e BOOTSTRAP_ADMIN_NAME=... migrate node dist/seed/bootstrap.js
 *
 * O administrador nasce com senha provisória (troca obrigatória no primeiro acesso) e, pela política
 * de 2FA das empresas novas, precisa ativar a verificação em duas etapas antes de usar o sistema.
 */
async function main() {
  const url = process.env.MIGRATION_DATABASE_URL;
  if (!url) throw new Error('MIGRATION_DATABASE_URL não definido');

  const tenantName = (process.env.BOOTSTRAP_TENANT_NAME ?? 'Cooperfarms').trim();
  const slug = (process.env.BOOTSTRAP_TENANT_SLUG ?? 'cooperfarms').trim();
  const matrizName = (process.env.BOOTSTRAP_MATRIZ_NAME ?? tenantName).trim();
  const email = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
  const adminName = process.env.BOOTSTRAP_ADMIN_NAME?.trim();
  const provided = process.env.BOOTSTRAP_ADMIN_PASSWORD;

  if (!/^[a-z0-9-]{3,40}$/.test(slug)) throw new Error('BOOTSTRAP_TENANT_SLUG inválido (a-z, 0-9 e hífen, 3 a 40 caracteres)');
  if (tenantName.length < 2 || matrizName.length < 2) throw new Error('Nome da empresa muito curto');
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('BOOTSTRAP_ADMIN_EMAIL obrigatório e válido');
  if (!adminName || adminName.length < 2) throw new Error('BOOTSTRAP_ADMIN_NAME obrigatório');
  if (provided !== undefined && provided.length < PASSWORD_MIN_LENGTH) throw new Error(`BOOTSTRAP_ADMIN_PASSWORD precisa ter ao menos ${PASSWORD_MIN_LENGTH} caracteres`);

  const db = new Database({ connectionString: url, poolMax: 2, applicationName: 'ordens-bootstrap' });
  try {
    if (await db.system((tx) => tx.tenant.findUnique({ where: { slug }, select: { id: true } }))) {
      console.log(`[bootstrap] a empresa "${slug}" já existe — nada a fazer`);
      return;
    }
    if (await db.system((tx) => tx.user.findUnique({ where: { email }, select: { id: true } }))) {
      throw new Error(`já existe um usuário com o e-mail ${email}`);
    }

    const password = provided || randomBytes(15).toString('base64url');
    const passwordHash = await hashPassword(password);
    const tenantId = randomUUID();

    await db.system(async (tx) => {
      const ctx = systemContext(tenantId);
      // 2FA obrigatória para quem publica ordens ou gerencia usuários (decisão de 18/09/2026).
      await tx.tenant.create({ data: { id: tenantId, slug, name: tenantName, require2faRoles: [...CRITICAL_2FA_ROLES] } });
      const matriz = await tx.organization.create({ data: { tenantId, kind: 'MATRIZ', name: matrizName } });
      await tx.unit.createMany({
        data: [
          { tenantId, code: 'KG', name: 'Quilograma', factorToKg: '1' },
          { tenantId, code: 'T', name: 'Tonelada', factorToKg: '1000' },
          { tenantId, code: 'SC60', name: 'Saca 60 kg', factorToKg: '60' },
        ],
      });
      const user = await tx.user.create({ data: { email, name: adminName, passwordHash, mustChangePassword: true } });
      const membership = await tx.membership.create({ data: { tenantId, userId: user.id, organizationId: matriz.id, scope: 'MATRIZ' } });
      await tx.membershipRole.create({ data: { membershipId: membership.id, roleCode: 'MATRIZ_ADMIN', tenantId } });
      await writeAudit(tx, ctx, { ...EMPTY_META, actorRole: 'BOOTSTRAP' }, {
        entityType: 'tenant',
        entityId: tenantId,
        action: 'tenant.bootstrapped',
        after: { slug, name: tenantName, adminEmail: email },
      });
    }, tenantId);

    console.log(`[bootstrap] empresa "${tenantName}" criada, com o Administrador Matriz ${email}`);
    if (!provided) {
      console.log('════════════════════════════════════════════════════════════');
      console.log('[bootstrap] senha provisória (exibida apenas agora; será trocada no primeiro acesso):');
      console.log(`            ${password}`);
      console.log('════════════════════════════════════════════════════════════');
    }
  } finally {
    await db.disconnect();
  }
}

main().catch((err) => {
  console.error('[bootstrap] falhou:', err instanceof Error ? err.message : err);
  process.exit(1);
});
