import { AbortMultipartUploadCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { SUPPORT_ATTACHMENT_RETENTION_DAYS } from '@ordens/contracts';
import { systemContext } from '@ordens/db';
import type { Job } from 'bullmq';
import type { Redis } from 'ioredis';
import type { WorkerContext } from '../context.js';
import { expireReportJobs } from './report-export.js';
import { notifySupportSla } from './support-sla.js';

const STALE_MS = 24 * 3_600_000;
const SUPPORT_RETENTION_MS = SUPPORT_ATTACHMENT_RETENTION_DAYS * 24 * 3_600_000;

/** Rotinas agendadas: expira envios órfãos, apaga anexos vencidos do atendimento e cobra o SLA. */
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
    const purged = await purgeSupportAttachments(ctx);
    if (purged) ctx.logger.info({ count: purged, dias: SUPPORT_ATTACHMENT_RETENTION_DAYS }, 'Anexos do atendimento apagados por retenção');
  };
}

/**
 * Retenção dos anexos do atendimento: a imagem pode trazer o que estava aberto na tela de quem enviou,
 * então o objeto é apagado do storage depois do prazo. O registro fica, marcado, para a conversa
 * continuar fazendo sentido no histórico.
 */
async function purgeSupportAttachments(ctx: WorkerContext): Promise<number> {
  const cutoff = new Date(Date.now() - SUPPORT_RETENTION_MS);
  const expired = await ctx.db.system((tx) =>
    tx.fileUpload.findMany({
      where: { entityType: 'support_conversation', status: { not: 'REMOVED' }, createdAt: { lt: cutoff } },
      select: { id: true, tenantId: true, bucket: true, objectKey: true },
      take: 500,
    }),
  );
  for (const u of expired) {
    await ctx.s3
      .send(new DeleteObjectCommand({ Bucket: u.bucket, Key: u.objectKey }))
      .catch((err: unknown) => ctx.logger.warn({ err, uploadId: u.id }, 'Falha ao apagar anexo do atendimento'));
    await ctx.db.run(systemContext(u.tenantId), (tx) =>
      tx.fileUpload.update({
        where: { id: u.id },
        data: { status: 'REMOVED', removedAt: new Date(), removeReason: `Retenção de ${SUPPORT_ATTACHMENT_RETENTION_DAYS} dias do atendimento` },
      }),
    );
  }
  return expired.length;
}
