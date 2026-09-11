import { GetObjectCommand } from '@aws-sdk/client-s3';
import {
  INVOICE_DIVERGENCE_LABELS,
  type InvoiceIssue,
  type InvoiceRejectCode,
  type NfeExtract,
} from '@ordens/contracts';
import { Prisma, systemContext, writeAudit, writeOutbox } from '@ordens/db';
import type { Job } from 'bullmq';
import { systemMeta, type WorkerContext } from '../context.js';
import { NfeParseError, parseNfe } from '../nfe/parse-nfe.js';
import type { OutboxJob } from '../queues.js';

const D = Prisma.Decimal;
/** Tolerância mínima de peso quando a OC não define uma (Q15/Q17). */
const MIN_WEIGHT_TOLERANCE_PCT = new D('0.5');

interface Context {
  loadPlates: string[];
  loadNetKg: Prisma.Decimal | null;
  tolerancePct: Prisma.Decimal;
  origin: 'FARM' | 'MATRIZ';
  sellerDocument: string | null;
}

/** Divergências não bloqueiam: a nota fica "Com divergência" (Q15). */
export function evaluateDivergences(nfe: NfeExtract, c: Context): InvoiceIssue[] {
  const issues: InvoiceIssue[] = [];
  const onlyDigits = (v: string | null) => v?.replace(/\D/g, '') ?? null;

  const seller = onlyDigits(c.sellerDocument);
  if (c.origin === 'FARM' && seller && nfe.issuer.document && nfe.issuer.document !== seller) {
    issues.push({ code: 'ISSUER_MISMATCH', message: INVOICE_DIVERGENCE_LABELS.ISSUER_MISMATCH, expected: seller, actual: nfe.issuer.document });
  }
  if (nfe.plate && c.loadPlates.length && !c.loadPlates.includes(nfe.plate)) {
    issues.push({ code: 'PLATE_MISMATCH', message: INVOICE_DIVERGENCE_LABELS.PLATE_MISMATCH, expected: c.loadPlates.join(', '), actual: nfe.plate });
  }
  if (nfe.netWeightKg && c.loadNetKg && c.loadNetKg.greaterThan(0)) {
    const pct = D.max(c.tolerancePct, MIN_WEIGHT_TOLERANCE_PCT);
    const limit = c.loadNetKg.times(pct).dividedBy(100);
    if (new D(nfe.netWeightKg).minus(c.loadNetKg).abs().greaterThan(limit)) {
      issues.push({ code: 'WEIGHT_MISMATCH', message: INVOICE_DIVERGENCE_LABELS.WEIGHT_MISMATCH, expected: c.loadNetKg.toString(), actual: nfe.netWeightKg });
    }
  }
  if (!nfe.protocolStatus) issues.push({ code: 'NO_PROTOCOL', message: INVOICE_DIVERGENCE_LABELS.NO_PROTOCOL });
  return issues;
}

/**
 * Registra NF-e (XML) anexada a uma carga depois que o upload ficou disponível.
 * Idempotente por file_upload_id; o XML é lido fora da transação.
 */
export function invoiceProcessingHandler(ctx: WorkerContext) {
  return async (job: Job<OutboxJob>) => {
    const { payload, tenantId, correlationId } = job.data;
    if (!tenantId || payload.kind !== 'NFE_XML' || payload.entityType !== 'load') return;
    const uploadId = String(payload.uploadId);
    const sysCtx = systemContext(tenantId);
    const meta = systemMeta(correlationId);

    const source = await ctx.db.run(sysCtx, async (tx) => {
      if (await tx.invoice.findUnique({ where: { fileUploadId: uploadId }, select: { id: true } })) return null;
      const upload = await tx.fileUpload.findUnique({ where: { id: uploadId } });
      if (!upload || upload.status !== 'AVAILABLE') return null;
      const load = await tx.load.findUnique({ where: { id: upload.entityId } });
      if (!load) return null;
      const [org, order] = await Promise.all([
        tx.organization.findUnique({ where: { id: upload.organizationId }, select: { kind: true } }),
        tx.loadingOrder.findUniqueOrThrow({ where: { id: load.orderId }, select: { tolerancePct: true, sellerPartnerId: true } }),
      ]);
      const seller = order.sellerPartnerId
        ? await tx.businessPartner.findUnique({ where: { id: order.sellerPartnerId }, select: { document: true } })
        : null;
      return { upload, load, order, uploaderIsFarm: org?.kind === 'FARM', sellerDocument: seller?.document?.replace(/\D/g, '') ?? null };
    });
    if (!source) return;

    const obj = await ctx.s3.send(new GetObjectCommand({ Bucket: source.upload.bucket, Key: source.upload.objectKey }));
    const xml = (await (obj.Body as { transformToString(encoding?: string): Promise<string> }).transformToString('utf-8')).replace(/^\uFEFF/, '');

    let nfe: NfeExtract | null = null;
    let reject: InvoiceRejectCode | null = null;
    try {
      nfe = parseNfe(xml);
      if (nfe.protocolStatus && nfe.protocolStatus !== '100') reject = 'NOT_AUTHORIZED';
    } catch (err) {
      if (!(err instanceof NfeParseError)) throw err;
      reject = err.code;
    }
    const divergences =
      nfe && !reject
        ? evaluateDivergences(nfe, {
            loadPlates: source.load.plates,
            loadNetKg: source.load.netKg,
            tolerancePct: source.order.tolerancePct,
            origin: source.uploaderIsFarm ? 'FARM' : 'MATRIZ',
            sellerDocument: source.sellerDocument,
          })
        : [];

    await ctx.db.run(sysCtx, async (tx) => {
      if (nfe && !reject) {
        const duplicate = await tx.invoice.findFirst({ where: { accessKey: nfe.accessKey, status: { in: ['VALID', 'DIVERGENT'] } }, select: { id: true } });
        if (duplicate) reject = 'DUPLICATE';
      }
      const status = reject ? 'REJECTED' : divergences.length ? 'DIVERGENT' : 'VALID';
      const invoice = await tx.invoice.create({
        data: {
          tenantId,
          loadId: source.load.id,
          orderId: source.load.orderId,
          fileUploadId: uploadId,
          // Nota da Fazenda: enviada por ela ou emitida pelo vendedor da ordem (Matriz pode anexar em nome dela).
          origin: source.uploaderIsFarm || (nfe?.issuer.document && nfe.issuer.document === source.sellerDocument) ? 'FARM' : 'MATRIZ',
          status,
          ...(nfe
            ? {
                accessKey: nfe.accessKey,
                number: nfe.number,
                series: nfe.series,
                issuedAt: nfe.issuedAt ? new Date(nfe.issuedAt) : null,
                issuerDocument: nfe.issuer.document,
                issuerName: nfe.issuer.name,
                recipientDocument: nfe.recipient.document,
                recipientName: nfe.recipient.name,
                totalValue: nfe.totalValue,
                netWeightKg: nfe.netWeightKg,
                grossWeightKg: nfe.grossWeightKg,
                quantity: nfe.quantity,
                quantityUnit: nfe.quantityUnit,
                productDescription: nfe.productDescription,
                plate: nfe.plate,
                protocolStatus: nfe.protocolStatus,
              }
            : {}),
          divergences: divergences as unknown as Prisma.InputJsonValue,
          rejectReason: reject,
          createdBy: source.upload.createdBy,
        },
      });
      const summary = { number: nfe?.number ?? null, accessKey: nfe?.accessKey ?? null, status, rejectReason: reject, divergences: divergences.map((d) => d.code) };
      await writeAudit(tx, sysCtx, meta, { entityType: 'invoice', entityId: invoice.id, action: reject ? 'invoice.rejected' : 'invoice.registered', after: summary });
      await writeAudit(tx, sysCtx, meta, {
        entityType: 'loading_order',
        entityId: source.load.orderId,
        action: 'order.invoice_attached',
        after: { loadNumber: source.load.number, ...summary },
      });
      await writeOutbox(tx, sysCtx, meta, {
        type: 'invoice.processed',
        aggregateType: 'invoice',
        aggregateId: invoice.id,
        payload: { invoiceId: invoice.id, loadId: source.load.id, orderId: source.load.orderId, status, createdBy: source.upload.createdBy },
      });
    });
    ctx.logger.info({ uploadId, loadId: source.load.id, reject, divergences: divergences.length }, 'NF-e processada');
  };
}
