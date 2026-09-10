import { randomBytes } from 'node:crypto';
import { Database } from '../client.js';
import { seedDemo } from './demo.js';
import { syncReference } from './reference.js';

/**
 * Executado pelo job de migration.
 * - Referência (RBAC): sempre, idempotente.
 * - Demo: somente fora de produção e com SEED_DEMO=true (ADR-006).
 */
async function main() {
  const url = process.env.MIGRATION_DATABASE_URL;
  if (!url) throw new Error('MIGRATION_DATABASE_URL não definido');

  const db = new Database({ connectionString: url, poolMax: 2, applicationName: 'ordens-seed' });
  try {
    await syncReference(db.prisma);
    console.log('[seed] catálogo de papéis e permissões sincronizado');

    const isProduction = process.env.NODE_ENV === 'production';
    if (process.env.SEED_DEMO !== 'true' || isProduction) {
      console.log(`[seed] dados demo ignorados (SEED_DEMO=${process.env.SEED_DEMO ?? 'unset'}, NODE_ENV=${process.env.NODE_ENV})`);
      return;
    }

    const provided = process.env.SEED_DEMO_PASSWORD?.trim();
    const password = provided || randomBytes(15).toString('base64url');
    const { created } = await seedDemo(db, password);

    if (!created) {
      console.log('[seed] dados demo já existem — nada a fazer');
    } else if (provided) {
      console.log('[seed] dados demo criados com a senha de SEED_DEMO_PASSWORD');
    } else {
      console.log('════════════════════════════════════════════════════════════');
      console.log('[seed] dados demo criados. Senha gerada (exibida apenas agora):');
      console.log(`       ${password}`);
      console.log('       usuário ex.: admin@graoforte.demo');
      console.log('════════════════════════════════════════════════════════════');
    }
  } finally {
    await db.disconnect();
  }
}

main().catch((err) => {
  console.error('[seed] falhou:', err);
  process.exit(1);
});
