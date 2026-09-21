import { z } from 'zod';

/** Texto opcional: vazio (variável definida sem valor no compose) vale como ausente. */
const optionalText = () =>
  z
    .string()
    .trim()
    .optional()
    .transform((v) => v || undefined);

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const schema = z
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
    /** Autenticação do servidor de e-mail (vazio = sem autenticação, como o Mailpit de desenvolvimento). */
    SMTP_USER: z.string().optional(),
    SMTP_PASSWORD: z.string().optional(),
    /** true = TLS desde a conexão (porta 465). */
    SMTP_SECURE: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
    /** true = exige STARTTLS (porta 587) e recusa enviar sem criptografia. */
    SMTP_REQUIRE_TLS: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
    MAIL_FROM: z.string().default('Ordens <nao-responda@ordens.local>'),
    /** smtp = servidor SMTP (Mailpit em desenvolvimento); graph = Microsoft Graph (Microsoft 365). */
    MAIL_TRANSPORT: z.enum(['smtp', 'graph']).default('smtp'),
    /** Aplicativo do Entra ID e caixa remetente (obrigatórios com MAIL_TRANSPORT=graph). */
    GRAPH_TENANT_ID: optionalText(),
    GRAPH_CLIENT_ID: optionalText(),
    GRAPH_CLIENT_SECRET: optionalText(),
    GRAPH_SENDER: optionalText(),
    /** Endereços da nuvem Microsoft (mude só para nuvens soberanas ou testes). */
    GRAPH_AUTHORITY_URL: z.url().default('https://login.microsoftonline.com'),
    GRAPH_API_URL: z.url().default('https://graph.microsoft.com'),
    WORKER_HEALTH_PORT: z.coerce.number().int().default(4100),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production' && env.SCANNER === 'noop') {
      ctx.addIssue({ code: 'custom', path: ['SCANNER'], message: 'SCANNER=noop é proibido em produção' });
    }
    if (env.MAIL_TRANSPORT === 'graph') {
      for (const key of ['GRAPH_TENANT_ID', 'GRAPH_CLIENT_ID', 'GRAPH_CLIENT_SECRET', 'GRAPH_SENDER'] as const) {
        if (!env[key]) ctx.addIssue({ code: 'custom', path: [key], message: `obrigatório com MAIL_TRANSPORT=graph` });
      }
      if (env.GRAPH_TENANT_ID && !GUID.test(env.GRAPH_TENANT_ID)) ctx.addIssue({ code: 'custom', path: ['GRAPH_TENANT_ID'], message: 'deve ser o ID do diretório (GUID)' });
      if (env.GRAPH_CLIENT_ID && !GUID.test(env.GRAPH_CLIENT_ID)) ctx.addIssue({ code: 'custom', path: ['GRAPH_CLIENT_ID'], message: 'deve ser o ID do aplicativo (GUID)' });
      if (env.GRAPH_SENDER && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(env.GRAPH_SENDER)) ctx.addIssue({ code: 'custom', path: ['GRAPH_SENDER'], message: 'deve ser um endereço de e-mail' });
    }
  });

export type WorkerEnv = z.infer<typeof schema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): WorkerEnv {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    throw new Error(`Configuração inválida do worker:\n${parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n')}`);
  }
  return parsed.data;
}
