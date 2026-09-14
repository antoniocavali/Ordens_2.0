import { defineConfig } from 'prisma/config';

/**
 * Migrations executam como ordens_owner (MIGRATION_DATABASE_URL).
 * A aplicação usa DATABASE_URL (ordens_app, sem BYPASSRLS) via driver adapter.
 */
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: process.env.MIGRATION_DATABASE_URL ?? 'postgresql://ordens_owner:ordens_owner@localhost:5432/ordens',
  },
});
