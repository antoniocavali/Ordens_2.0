import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { Database } from '@ordens/db';
import { Redis } from 'ioredis';
import { ENV, loadEnv, type Env } from '../config/env.js';
import { StorageService } from './storage.service.js';
import { TenantDb } from './tenant-db.service.js';

export const REDIS = Symbol('REDIS');

/**
 * Infraestrutura compartilhada. A API não publica jobs diretamente:
 * integrações assíncronas saem pela outbox (relay no worker), na mesma transação do domínio.
 */
@Global()
@Module({
  providers: [
    { provide: ENV, useFactory: () => loadEnv() },
    {
      provide: Database,
      inject: [ENV],
      useFactory: (env: Env) =>
        new Database({ connectionString: env.DATABASE_URL, poolMax: env.DATABASE_POOL_MAX, applicationName: 'ordens-api' }),
    },
    {
      provide: REDIS,
      inject: [ENV],
      useFactory: (env: Env) => new Redis(env.REDIS_URL, { maxRetriesPerRequest: 2, enableOfflineQueue: false }),
    },
    TenantDb,
    StorageService,
  ],
  exports: [ENV, Database, REDIS, TenantDb, StorageService],
})
export class InfraModule implements OnApplicationShutdown {
  constructor(
    private readonly db: Database,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async onApplicationShutdown(): Promise<void> {
    await Promise.allSettled([this.db.disconnect(), this.redis.quit()]);
  }
}
