import { AbortMultipartUploadCommand } from '@aws-sdk/client-s3';
import { systemContext } from '@ordens/db';
import type { Job } from 'bullmq';
import type { Redis } from 'ioredis';
import type { WorkerContext } from '../context.js';
import { expireReportJobs } from './report-export.js';
import { notifySupportSla } from './support-sla.js';

const STALE_MS = 24 * 3_600_000;

/** Rotinas agendadas: expira envios órfãos e cobra o SLA do atendimento. */
export function maintenanceHandler(ctx: WorkerContext, publisher: Redis) {
  return async (job: Job) => {
    if (job.name === 'support-sla') return notifySupportSla(ctx, publisher);

    const cutoff = new Date(Date.now() - STALE_MS);
    const stale = await ctx.db.system((tx) =>
      tx.fileUpload.findMany({
        where: { status: { in: ['PENDING', 'UPLOADING'] }, createdAt: { lt: cutoff } },
        select: { id: true, tenantId: true, bucket: true, objectKey: true, multipartId: true },
        take: 500,
      }),
    );
    for (const u of stale) {
      if (u.multipartId) {
        await ctx.s3
          .send(new AbortMultipartUploadCommand({ Bucket: u.bucket, Key: u.objectKey, UploadId: u.multipartId }))
          .catch((err: unknown) => ctx.logger.warn({ err, uploadId: u.id }, 'Falha ao abortar multipart'));
      }
      await ctx.db.run(systemContext(u.tenantId), (tx) => tx.fileUpload.update({ where: { id: u.id }, data: { status: 'EXPIRED' } }));
    }
    if (stale.length) ctx.logger.info({ count: stale.length }, 'Envios expirados');
    const reports = await expireReportJobs(ctx);
    if (reports) ctx.logger.info({ count: reports }, 'Exportações de relatório expiradas');
  };
}
