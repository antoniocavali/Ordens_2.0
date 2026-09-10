import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from './generated/prisma/client.js';
import { contextToSettings, systemContext, type DbContext } from './context.js';

export type Tx = Prisma.TransactionClient;

export interface DatabaseOptions {
  connectionString: string;
  poolMax?: number;
  /** Nome da aplicação visível em pg_stat_activity. */
  applicationName?: string;
}

export interface RunOptions {
  isolationLevel?: Prisma.TransactionIsolationLevel;
  /** Tempo máximo da transação em ms. Mantenha curto: transações não devem envolver I/O externo. */
  timeoutMs?: number;
}

/**
 * Acesso ao banco com contexto RLS por unidade transacional curta.
 * Nunca mantenha uma transação aberta durante toda a requisição.
 */
export class Database {
  readonly prisma: PrismaClient;

  constructor(options: DatabaseOptions) {
    const adapter = new PrismaPg({
      connectionString: options.connectionString,
      max: options.poolMax ?? 10,
      application_name: options.applicationName ?? 'ordens',
    });
    this.prisma = new PrismaClient({ adapter });
  }

  /** Executa `fn` em uma transação com o contexto de segurança aplicado via set_config LOCAL. */
  run<T>(ctx: DbContext, fn: (tx: Tx) => Promise<T>, options: RunOptions = {}): Promise<T> {
    return this.prisma.$transaction(
      async (tx) => {
        await applyContext(tx, ctx);
        return fn(tx);
      },
      {
        maxWait: 5_000,
        timeout: options.timeoutMs ?? 15_000,
        ...(options.isolationLevel ? { isolationLevel: options.isolationLevel } : {}),
      },
    );
  }

  /** Atalho para contexto SYSTEM (ver systemContext). Uso restrito e revisado. */
  system<T>(fn: (tx: Tx) => Promise<T>, tenantId: string | null = null, options?: RunOptions): Promise<T> {
    return this.run(systemContext(tenantId), fn, options);
  }

  async ping(): Promise<void> {
    await this.prisma.$queryRaw`select 1`;
  }

  async disconnect(): Promise<void> {
    await this.prisma.$disconnect();
  }
}

async function applyContext(tx: Tx, ctx: DbContext): Promise<void> {
  const settings = contextToSettings(ctx);
  // Parâmetros bind: nenhum valor é interpolado no SQL.
  await tx.$queryRaw`
    select
      set_config(${settings[0]![0]}, ${settings[0]![1]}, true),
      set_config(${settings[1]![0]}, ${settings[1]![1]}, true),
      set_config(${settings[2]![0]}, ${settings[2]![1]}, true),
      set_config(${settings[3]![0]}, ${settings[3]![1]}, true),
      set_config(${settings[4]![0]}, ${settings[4]![1]}, true)
  `;
}
