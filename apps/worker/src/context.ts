import { S3Client } from '@aws-sdk/client-s3';
import { Database, EMPTY_META, type ActorMeta } from '@ordens/db';
import pino from 'pino';
import type { WorkerEnv } from './env.js';

export interface WorkerContext {
  env: WorkerEnv;
  db: Database;
  s3: S3Client;
  logger: pino.Logger;
  redisConnection: { url: string };
}

export function createContext(env: WorkerEnv): WorkerContext {
  return {
    env,
    db: new Database({ connectionString: env.DATABASE_URL, poolMax: env.DATABASE_POOL_MAX, applicationName: 'ordens-worker' }),
    s3: new S3Client({
      endpoint: env.S3_ENDPOINT,
      region: env.S3_REGION,
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
      credentials: { accessKeyId: env.S3_ACCESS_KEY, secretAccessKey: env.S3_SECRET_KEY },
    }),
    logger: pino({
      level: env.LOG_LEVEL,
      base: { service: 'worker' },
      transport: env.NODE_ENV === 'development' ? { target: 'pino-pretty', options: { singleLine: true } } : undefined,
    }),
    redisConnection: { url: env.REDIS_URL },
  };
}

/** Metadados de auditoria para ações do sistema (jobs). */
export function systemMeta(correlationId: string | null): ActorMeta {
  return { ...EMPTY_META, actorRole: 'SYSTEM_WORKER', correlationId };
}
