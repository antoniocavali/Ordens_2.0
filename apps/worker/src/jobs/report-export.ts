import { DeleteObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { effectivePermissions, REPORT_JOB_LIMITS, REPORT_JOB_RETENTION_DAYS, type ReportFormat, type ReportKind } from '@ordens/contracts';
import { extraPermissionsByMembership, systemContext, writeAudit, writeOutbox, type DbContext } from '@ordens/db';
import { renderReport, ReportError, runReport } from '@ordens/reports';
import type { Job } from 'bullmq';
import { systemMeta, type WorkerContext } from '../context.js';
import type { OutboxJob } from '../queues.js';

/** Tempo máximo da consulta de um relatório grande (a exportação imediata usa o padrão de 15 s). */
const QUERY_TIMEOUT_MS = 5 * 60_000;

/**
 * Gera um relatório pedido em segundo plano. A consulta roda com o contexto de RLS de quem pediu
 * (mesma organização, perfil e permissões do momento da geração), nunca como SYSTEM.
 */
export function reportExportHandler(ctx: WorkerContext) {
  return async (job: Job<OutboxJob>) => {
    const { tenantId, correlationId } = job.data;
    const jobId = String(job.data.payload.jobId);
    if (!tenantId) throw new Error('Evento sem tenant');
    const sys = systemContext(tenantId);
    const meta = systemMeta(correlationId);

    const record = await ctx.db.run(sys, (tx) => tx.reportJob.findUnique({ where: { id: jobId } }));
    // Idempotente: só processa o que está na fila (ou ficou pela metade numa tentativa anterior).
    if (!record || !['PENDING', 'RUNNING'].includes(record.status)) return;
    await ctx.db.run(sys, (tx) => tx.reportJob.update({ where: { id: jobId }, data: { status: 'RUNNING', startedAt: new Date() } }));

    const fail = async (message: string) => {
      await ctx.db.run(sys, async (tx) => {
        await tx.reportJob.update({ where: { id: jobId }, data: { status: 'FAILED', error: message, finishedAt: new Date() } });
        await writeOutbox(tx, sys, meta, { type: 'report.failed', aggregateType: 'report_job', aggregateId: jobId, payload: { jobId, userId: record.requestedBy, kind: record.kind, error: message } });
      });
    };

    // Contexto de quem pediu, conferindo que o acesso segue ativo e com permissão de exportar.
    const membership = await ctx.db.run(sys, async (tx) => {
      const m = await tx.membership.findFirst({
        where: { id: record.membershipId, userId: record.requestedBy, status: 'ACTIVE', user: { status: 'ACTIVE' } },
        select: { id: true, tenantId: true, organizationId: true, scope: true, roles: { select: { roleCode: true } } },
      });
      if (!m) return null;
      const extra = (await extraPermissionsByMembership(tx, [m.id])).get(m.id) ?? [];
      return { ...m, permissions: effectivePermissions(m.roles.map((r) => r.roleCode), extra) };
    });
    if (!membership || !membership.permissions.has('report.export')) {
      await fail('Você não tem mais permissão para exportar relatórios nesta organização.');
      return;
    }
    const userCtx: DbContext = {
      tenantId: membership.tenantId,
      userId: record.requestedBy,
      membershipId: membership.id,
      scope: membership.scope,
      orgIds: [membership.organizationId],
    };

    const format = record.format as ReportFormat;
    const params = (record.params ?? {}) as { from?: string; to?: string; commodityId?: string };
    let result;
    try {
      result = await ctx.db.run(userCtx, (tx) => runReport(tx, record.kind as ReportKind, params, REPORT_JOB_LIMITS[format], membership.scope), {
        timeoutMs: QUERY_TIMEOUT_MS,
      });
    } catch (err) {
      if (err instanceof ReportError) return fail(err.message);
      ctx.logger.error({ err, jobId }, 'Falha ao gerar relatório');
      return fail('Não foi possível gerar o relatório. Tente um período menor.');
    }

    const file = await renderReport(result, format);
    const body = typeof file.body === 'string' ? Buffer.from(file.body, 'utf8') : file.body;
    const bucket = ctx.env.S3_BUCKET_DOCUMENTS;
    const objectKey = `t/${tenantId}/relatorios/${jobId}.${format}`;
    await ctx.s3.send(new PutObjectCommand({ Bucket: bucket, Key: objectKey, Body: body, ContentType: file.contentType }));

    const finishedAt = new Date();
    await ctx.db.run(sys, async (tx) => {
      await tx.reportJob.update({
        where: { id: jobId },
        data: {
          status: 'DONE',
          rows: result.rows.length,
          total: result.total,
          truncated: result.truncated,
          bucket,
          objectKey,
          sizeBytes: BigInt(body.length),
          finishedAt,
          expiresAt: new Date(finishedAt.getTime() + REPORT_JOB_RETENTION_DAYS * 86_400_000),
        },
      });
      await writeAudit(tx, sys, { ...meta, actorUserId: record.requestedBy }, {
        entityType: 'report_job',
        entityId: jobId,
        action: 'report.exported',
        after: { kind: record.kind, format, background: true, from: result.from, to: result.to, rows: result.rows.length, total: result.total },
      });
      await writeOutbox(tx, sys, meta, {
        type: 'report.ready',
        aggregateType: 'report_job',
        aggregateId: jobId,
        payload: { jobId, userId: record.requestedBy, kind: record.kind, label: result.label, rows: result.rows.length, truncated: result.truncated },
      });
    });
  };
}

/** Manutenção: apaga os arquivos de exportações vencidas e marca como expiradas. */
export async function expireReportJobs(ctx: WorkerContext): Promise<number> {
  const expired = await ctx.db.system((tx) =>
    tx.reportJob.findMany({ where: { status: 'DONE', expiresAt: { lt: new Date() } }, select: { id: true, tenantId: true, bucket: true, objectKey: true }, take: 500 }),
  );
  for (const j of expired) {
    if (j.bucket && j.objectKey) {
      await ctx.s3.send(new DeleteObjectCommand({ Bucket: j.bucket, Key: j.objectKey })).catch((err: unknown) => ctx.logger.warn({ err, jobId: j.id }, 'Falha ao apagar exportação'));
    }
    await ctx.db.run(systemContext(j.tenantId), (tx) => tx.reportJob.update({ where: { id: j.id }, data: { status: 'EXPIRED', bucket: null, objectKey: null } }));
  }
  return expired.length;
}
