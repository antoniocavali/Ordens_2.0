import type { Database, RunOptions, Tx } from './client.js';
import type { DbContext } from './context.js';
import { toAuditJson } from './serialize.js';

/** Metadados da requisição (capturados pelo interceptor HTTP ou pelo job). */
export interface ActorMeta {
  actorUserId: string | null;
  actorMembershipId: string | null;
  actorRole: string | null;
  ip: string | null;
  userAgent: string | null;
  sessionId: string | null;
  requestId: string | null;
  correlationId: string | null;
}

export interface AuditInput {
  entityType: string;
  entityId?: string | null;
  action: string;
  before?: unknown;
  after?: unknown;
  metadata?: unknown;
}

export interface OutboxInput {
  type: string;
  aggregateType: string;
  aggregateId?: string | null;
  payload: unknown;
}

export interface UnitOfWorkScope {
  tx: Tx;
  ctx: DbContext;
  meta: ActorMeta;
  /** Grava auditoria na MESMA transação. Falha → rollback de tudo. */
  audit(input: AuditInput): Promise<void>;
  /** Enfileira evento na outbox na MESMA transação. */
  outbox(input: OutboxInput): Promise<void>;
}

export const EMPTY_META: ActorMeta = {
  actorUserId: null,
  actorMembershipId: null,
  actorRole: null,
  ip: null,
  userAgent: null,
  sessionId: null,
  requestId: null,
  correlationId: null,
};

// createMany (INSERT sem RETURNING): quem grava auditoria/outbox não precisa ter permissão de leitura dessas tabelas.
export async function writeAudit(tx: Tx, ctx: DbContext, meta: ActorMeta, input: AuditInput): Promise<void> {
  await tx.auditEvent.createMany({
    data: {
      tenantId: ctx.tenantId,
      actorUserId: meta.actorUserId,
      actorMembershipId: meta.actorMembershipId,
      actorRole: meta.actorRole,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      action: input.action,
      before: input.before === undefined ? undefined : toAuditJson(input.before),
      after: input.after === undefined ? undefined : toAuditJson(input.after),
      metadata: input.metadata === undefined ? undefined : toAuditJson(input.metadata),
      ip: meta.ip,
      userAgent: meta.userAgent?.slice(0, 512) ?? null,
      sessionId: meta.sessionId,
      requestId: meta.requestId,
      correlationId: meta.correlationId,
    },
  });
}

export async function writeOutbox(tx: Tx, ctx: DbContext, meta: ActorMeta, input: OutboxInput): Promise<void> {
  await tx.outboxEvent.createMany({
    data: {
      tenantId: ctx.tenantId,
      type: input.type,
      aggregateType: input.aggregateType,
      aggregateId: input.aggregateId ?? null,
      payload: toAuditJson(input.payload),
      correlationId: meta.correlationId,
    },
  });
}

export class UnitOfWork {
  constructor(private readonly db: Database) {}

  run<T>(
    ctx: DbContext,
    meta: ActorMeta,
    fn: (scope: UnitOfWorkScope) => Promise<T>,
    options?: RunOptions,
  ): Promise<T> {
    return this.db.run(
      ctx,
      (tx) =>
        fn({
          tx,
          ctx,
          meta,
          audit: (input) => writeAudit(tx, ctx, meta, input),
          outbox: (input) => writeOutbox(tx, ctx, meta, input),
        }),
      options,
    );
  }
}
