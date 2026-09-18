import { z } from 'zod';

const bool = z
  .enum(['true', 'false'])
  .default('false')
  .transform((v) => v === 'true');

const base64Key = z
  .string()
  .min(1, 'obrigatório')
  .refine((v) => Buffer.from(v, 'base64').length === 32, 'deve conter 32 bytes em base64');

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    API_PORT: z.coerce.number().int().default(4000),
    WEB_ORIGIN: z.url(),

    DATABASE_URL: z.string().startsWith('postgres'),
    DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(200).default(20),
    REDIS_URL: z.string().startsWith('redis'),

    S3_ENDPOINT: z.url(),
    S3_PUBLIC_ENDPOINT: z.url(),
    S3_REGION: z.string().default('us-east-1'),
    S3_ACCESS_KEY: z.string().min(3),
    S3_SECRET_KEY: z.string().min(8),
    S3_FORCE_PATH_STYLE: bool,
    S3_BUCKET_QUARANTINE: z.string().min(3),
    S3_BUCKET_DOCUMENTS: z.string().min(3),
    UPLOAD_MAX_BYTES: z.coerce.number().int().positive().default(2 * 1024 * 1024 * 1024),
    SCANNER: z.enum(['noop', 'clamav']).default('noop'),

    SESSION_SECRET: base64Key,
    TWO_FACTOR_ENC_KEY: base64Key,
    SESSION_IDLE_HOURS: z.coerce.number().int().min(1).max(168).default(12),
    SESSION_ABSOLUTE_DAYS: z.coerce.number().int().min(1).max(90).default(7),
    COOKIE_SECURE: bool,
    /**
     * Proxies confiáveis para X-Forwarded-For (revisão de segurança 3.7). Número = saltos fixos
     * (produção atrás do ingress: 1); texto = sub-redes aceitas pelo Express.
     */
    TRUST_PROXY: z
      .string()
      .default('loopback, linklocal, uniquelocal')
      .transform((v) => (/^\d+$/.test(v.trim()) ? Number(v) : v)),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production') {
      if (env.SCANNER === 'noop') {
        ctx.addIssue({ code: 'custom', path: ['SCANNER'], message: 'SCANNER=noop é proibido em produção' });
      }
      if (!env.COOKIE_SECURE) {
        ctx.addIssue({ code: 'custom', path: ['COOKIE_SECURE'], message: 'COOKIE_SECURE deve ser true em produção' });
      }
    }
  });

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Configuração inválida:\n${issues}`);
  }
  return parsed.data;
}

export const ENV = Symbol('ENV');
