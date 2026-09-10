import { AbortMultipartUploadCommand } from '@aws-sdk/client-s3';
import { systemContext } from '@ordens/db';
import type { WorkerContext } from '../context.js';

const STALE_MS = 24 * 3_600_000;

/** Aborta multiparts órfãos e expira envios nunca concluídos. */
export function maintenanceHandler(ctx: WorkerContext) {
  return async () => {
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
  };
}
