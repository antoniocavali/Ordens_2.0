import { createHash } from 'node:crypto';
import { PassThrough, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { CopyObjectCommand, DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { UPLOAD_RULES, type DocumentKind } from '@ordens/contracts';
import { writeAudit, writeOutbox, systemContext } from '@ordens/db';
import type { Job } from 'bullmq';
import { fileTypeFromBuffer } from 'file-type';
import { systemMeta, type WorkerContext } from '../context.js';
import type { OutboxJob } from '../queues.js';
import { ClamAvScanner, NoopScanner, type Scanner } from '../scanner.js';

const SNIFF_BYTES = 4_100;

function looksLikeXml(head: Buffer): boolean {
  const text = head.subarray(0, 200).toString('utf8').replace(/^\uFEFF/, '').trimStart();
  return text.startsWith('<?xml') || text.startsWith('<');
}

function looksLikeCsv(head: Buffer): boolean {
  return !head.subarray(0, 512).includes(0);
}

/**
 * Processa arquivo em quarentena: SHA-256 real, tipo por magic bytes, antivírus e promoção para o bucket de documentos.
 * Idempotente: só age em registros UPLOADED/PROCESSING.
 */
export function fileProcessingHandler(ctx: WorkerContext) {
  const scanner: Scanner = ctx.env.SCANNER === 'clamav' ? new ClamAvScanner(ctx.env.CLAMAV_HOST, ctx.env.CLAMAV_PORT) : new NoopScanner();

  return async (job: Job<OutboxJob>) => {
    const { payload, tenantId, correlationId } = job.data;
    const uploadId = String(payload.uploadId);
    if (!tenantId) throw new Error('Evento sem tenant');
    const sysCtx = systemContext(tenantId);
    const meta = systemMeta(correlationId);

    const upload = await ctx.db.run(sysCtx, (tx) => tx.fileUpload.findUnique({ where: { id: uploadId } }));
    if (!upload || !['UPLOADED', 'PROCESSING'].includes(upload.status)) {
      ctx.logger.info({ uploadId, status: upload?.status }, 'Upload ignorado (estado não processável)');
      return;
    }
    await ctx.db.run(sysCtx, (tx) => tx.fileUpload.update({ where: { id: uploadId }, data: { status: 'PROCESSING' } }));

    const obj = await ctx.s3.send(new GetObjectCommand({ Bucket: upload.bucket, Key: upload.objectKey }));
    const body = obj.Body as Readable;
    const hash = createHash('sha256');
    const chunks: Buffer[] = [];
    let captured = 0;
    const scanStream = new PassThrough();

    const scanPromise = scanner.scan(scanStream);
    await pipeline(body, async function* (source) {
      for await (const chunk of source as AsyncIterable<Buffer>) {
        hash.update(chunk);
        if (captured < SNIFF_BYTES) {
          chunks.push(chunk);
          captured += chunk.length;
        }
        if (!scanStream.write(chunk)) await new Promise((r) => scanStream.once('drain', r));
        yield chunk;
      }
      scanStream.end();
    }, new PassThrough().resume());

    const sha256 = hash.digest('hex');
    const scan = await scanPromise;
    const head = Buffer.concat(chunks).subarray(0, SNIFF_BYTES);
    const detected = await fileTypeFromBuffer(head);
    const kind = upload.kind as DocumentKind;
    const rule = UPLOAD_RULES[kind];

    let detectedMime = detected?.mime ?? null;
    if (!detectedMime && looksLikeXml(head)) detectedMime = 'application/xml';
    if (!detectedMime && kind === 'SPREADSHEET' && looksLikeCsv(head)) detectedMime = 'text/csv';

    let rejectReason: string | null = null;
    if (upload.sha256Declared && upload.sha256Declared !== sha256) rejectReason = 'checksum_mismatch';
    else if (!detectedMime || !(rule.mimes.includes(detectedMime) || (detectedMime === 'application/xml' && rule.mimes.includes('text/xml')))) {
      rejectReason = `content_type_mismatch:${detectedMime ?? 'unknown'}`;
    }

    if (scan.status === 'INFECTED') {
      await ctx.s3.send(new DeleteObjectCommand({ Bucket: upload.bucket, Key: upload.objectKey }));
      await ctx.db.run(sysCtx, async (tx) => {
        await tx.fileUpload.update({
          where: { id: uploadId },
          data: { status: 'INFECTED', scanStatus: 'INFECTED', sha256Actual: sha256, detectedMime, rejectReason: scan.signature },
        });
        await writeAudit(tx, sysCtx, meta, { entityType: 'file_upload', entityId: uploadId, action: 'upload.infected', metadata: { signature: scan.signature } });
      });
      ctx.logger.warn({ uploadId, signature: scan.signature }, 'Arquivo infectado removido');
      return;
    }

    if (rejectReason) {
      await ctx.s3.send(new DeleteObjectCommand({ Bucket: upload.bucket, Key: upload.objectKey }));
      await ctx.db.run(sysCtx, async (tx) => {
        await tx.fileUpload.update({
          where: { id: uploadId },
          data: { status: 'REJECTED', scanStatus: scan.status, sha256Actual: sha256, detectedMime, rejectReason },
        });
        await writeAudit(tx, sysCtx, meta, { entityType: 'file_upload', entityId: uploadId, action: 'upload.rejected', metadata: { reason: rejectReason } });
        await writeOutbox(tx, sysCtx, meta, {
          type: 'upload.rejected',
          aggregateType: 'file_upload',
          aggregateId: uploadId,
          payload: { uploadId, reason: rejectReason, createdBy: upload.createdBy },
        });
      });
      return;
    }

    // Promoção: quarentena → documentos (mesma chave), depois remove da quarentena.
    await ctx.s3.send(
      new CopyObjectCommand({
        Bucket: ctx.env.S3_BUCKET_DOCUMENTS,
        Key: upload.objectKey,
        CopySource: `${upload.bucket}/${upload.objectKey}`,
        MetadataDirective: 'REPLACE',
        ContentType: detectedMime ?? upload.declaredMime,
        Metadata: { sha256, 'upload-id': uploadId },
      }),
    );
    await ctx.s3.send(new DeleteObjectCommand({ Bucket: upload.bucket, Key: upload.objectKey }));

    await ctx.db.run(sysCtx, async (tx) => {
      await tx.fileUpload.update({
        where: { id: uploadId },
        data: { status: 'AVAILABLE', scanStatus: scan.status, sha256Actual: sha256, detectedMime, bucket: ctx.env.S3_BUCKET_DOCUMENTS },
      });
      await writeAudit(tx, sysCtx, meta, {
        entityType: 'file_upload',
        entityId: uploadId,
        action: 'upload.available',
        metadata: { sha256, detectedMime, scan: scan.status },
      });
      await writeOutbox(tx, sysCtx, meta, {
        type: 'upload.available',
        aggregateType: 'file_upload',
        aggregateId: uploadId,
        payload: { uploadId, kind, entityType: upload.entityType, entityId: upload.entityId },
      });
    });
    ctx.logger.info({ uploadId, sha256, scan: scan.status }, 'Upload disponível');
  };
}
