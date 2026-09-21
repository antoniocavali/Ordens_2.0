import { z } from 'zod';

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    DATABASE_URL: z.string().startsWith('postgres'),
    DATABASE_POOL_MAX: z.coerce.number().int().default(10),
    REDIS_URL: z.string().startsWith('redis'),
    S3_ENDPOINT: z.url(),
    S3_REGION: z.string().default('us-east-1'),
    S3_ACCESS_KEY: z.string(),
    S3_SECRET_KEY: z.string(),
    S3_FORCE_PATH_STYLE: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
    S3_BUCKET_QUARANTINE: z.string(),
    S3_BUCKET_DOCUMENTS: z.string(),
    SCANNER: z.enum(['noop', 'clamav']).default('noop'),
    CLAMAV_HOST: z.string().default('clamav'),
    CLAMAV_PORT: z.coerce.number().int().default(3310),
    SESSION_SECRET: z.string().min(1),
    /** Chave de cifragem de segredos (a mesma da API): decifra a senha da pasta de rede. */
    TWO_FACTOR_ENC_KEY: z.string().min(1),
    /**
     * Pastas locais/montadas liberadas para a cópia do XML (separadas por vírgula). Caminhos de rede
     * (\\servidor\compartilhamento) não precisam estar aqui.
     */
    XML_ARCHIVE_LOCAL_ROOTS: z
      .string()
      .default('')
      .transform((v) => v.split(',').map((s) => s.trim()).filter(Boolean)),
    WEB_ORIGIN: z.url(),
    SMTP_HOST: z.string().default('mailpit'),
    SMTP_PORT: z.coerce.number().int().default(1025),
    MAIL_FROM: z.string().default('Ordens <nao-responda@ordens.local>'),
    WORKER_HEALTH_PORT: z.coerce.number().int().default(4100),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production' && env.SCANNER === 'noop') {
      ctx.addIssue({ code: 'custom', path: ['SCANNER'], message: 'SCANNER=noop é proibido em produção' });
    }
  });

export type WorkerEnv = z.infer<typeof schema>;

export function loadEnv(): WorkerEnv {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(`Configuração inválida do worker:\n${parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n')}`);
  }
  return parsed.data;
}
