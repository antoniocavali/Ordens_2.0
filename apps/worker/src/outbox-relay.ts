import { Prisma } from '@ordens/db';
import { Queue } from 'bullmq';
import type { WorkerContext } from './context.js';
import { DEFAULT_JOB_OPTIONS, ROUTES, type OutboxJob } from './queues.js';

const BATCH = 100;
const MAX_ATTEMPTS = 10;

interface OutboxRow {
  id: string;
  tenant_id: string | null;
  type: string;
  aggregate_id: string | null;
  payload: Record<string, unknown>;
  correlation_id: string | null;
  attempts: number;
}

/**
 * Publica eventos da outbox nas filas (entrega at-least-once).
 * FOR UPDATE SKIP LOCKED permite múltiplas réplicas do worker; jobId = event id garante idempotência no BullMQ.
 */
export class OutboxRelay {
  private readonly queues = new Map<string, Queue>();
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private stopped = false;

  constructor(private readonly ctx: WorkerContext) {}

  start(intervalMs = 1_000) {
    const tick = async () => {
      if (this.stopped) return;
      if (!this.running) {
        this.running = true;
        try {
          let processed = 0;
          do {
            processed = await this.drainOnce();
          } while (processed === BATCH && !this.stopped);
        } catch (err) {
          this.ctx.logger.error({ err }, 'Falha no relay da outbox');
        } finally {
          this.running = false;
        }
      }
      this.timer = setTimeout(tick, intervalMs);
    };
    void tick();
  }

  async stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    await Promise.all([...this.queues.values()].map((q) => q.close()));
  }

  async drainOnce(): Promise<number> {
    return this.ctx.db.system(
      async (tx) => {
        const rows = await tx.$queryRaw<OutboxRow[]>(Prisma.sql`
          select id, tenant_id, type, aggregate_id, payload, correlation_id, attempts
          from outbox_events
          where published_at is null and attempts < ${MAX_ATTEMPTS}
          order by created_at
          limit ${BATCH}
          for update skip locked
        `);
        for (const row of rows) {
          const targets = ROUTES[row.type] ?? [];
          try {
            const job: OutboxJob = {
              eventId: row.id,
              type: row.type,
              tenantId: row.tenant_id,
              aggregateId: row.aggregate_id,
              correlationId: row.correlation_id,
              payload: row.payload,
            };
            for (const name of targets) {
              await this.queue(name).add(row.type, job, { ...DEFAULT_JOB_OPTIONS, jobId: `${row.id}` });
            }
            await tx.outboxEvent.update({ where: { id: row.id }, data: { publishedAt: new Date(), attempts: { increment: 1 } } });
          } catch (err) {
            this.ctx.logger.error({ err, eventId: row.id, type: row.type }, 'Falha ao publicar evento');
            await tx.outboxEvent.update({
              where: { id: row.id },
              data: { attempts: { increment: 1 }, lastError: String((err as Error).message).slice(0, 500) },
            });
          }
        }
        return rows.length;
      },
      null,
      { timeoutMs: 30_000 },
    );
  }

  private queue(name: string): Queue {
    let q = this.queues.get(name);
    if (!q) {
      q = new Queue(name, { connection: this.ctx.redisConnection });
      this.queues.set(name, q);
    }
    return q;
  }
}
