import { createDecipheriv, createHash } from 'node:crypto';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { renderFolderTemplate, XML_ARCHIVE_MAX_ATTEMPTS } from '@ordens/contracts';
import { systemContext, writeAudit, type Prisma } from '@ordens/db';
import type { Job } from 'bullmq';
import { systemMeta, type WorkerContext } from '../context.js';
import type { OutboxJob } from '../queues.js';
import { ArchiveError, createArchiveTarget, safeSegment, type ArchiveTarget } from '../xml-archive/target.js';

const PENDING: Prisma.InvoiceWhereInput = { archivedAt: null, origin: 'FARM', status: { in: ['VALID', 'DIVERGENT'] } };
const BATCH = 100;

/** Mesma derivação da API: chave própria para a senha da pasta de rede. */
function decryptPassword(encKeyBase64: string, payload: Uint8Array): string {
  const key = createHash('sha256').update(`xml-archive:${encKeyBase64}`).digest();
  const buf = Buffer.from(payload);
  const decipher = createDecipheriv('aes-256-gcm', key, buf.subarray(0, 12));
  decipher.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString('utf8');
}

const dateParts = (d: Date): [string, string, string] => {
  const [y = '0000', m = '00', day = '00'] = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d).split('-');
  return [y, m, day];
};
const digits = (v: string | null) => v?.replace(/\D/g, '') ?? '';

type InvoiceRow = {
  id: string;
  accessKey: string | null;
  issuedAt: Date | null;
  createdAt: Date;
  issuerName: string | null;
  issuerDocument: string | null;
  recipientDocument: string | null;
  fileUploadId: string | null;
  archiveAttempts: number;
};

/** Subpastas pelo modelo configurado (ex.: {ano}\{mes}\{dia}\{cnpj_emitente}\{tipo}) e nome do arquivo. */
export function archiveLocation(inv: InvoiceRow, template: string) {
  const [ano, mes, dia] = dateParts(inv.issuedAt ?? inv.createdAt);
  const dirs = renderFolderTemplate(template, {
    ano,
    mes,
    dia,
    cnpj_emitente: digits(inv.issuerDocument),
    cnpj_destinatario: digits(inv.recipientDocument),
    fazenda: inv.issuerName ? safeSegment(inv.issuerName) : '',
    tipo: 'NFE',
  }).map((d) => safeSegment(d));
  const name = inv.accessKey ? `${inv.accessKey}-nfe.xml` : `nota-${inv.id}.xml`;
  return { dirs, name };
}

/**
 * Cópia do XML da Fazenda na pasta de rede da empresa. Eventos:
 * - `invoice.processed`: copia a nota recém-registrada;
 * - `xml_archive.retry_requested`: copia as pendentes (ao ativar, trocar o destino ou pelo botão);
 * - `xml_archive.test_requested`: grava e apaga um arquivo de teste.
 * Falha de rede não derruba o job: a nota fica pendente com o motivo e a varredura tenta de novo.
 */
export function xmlArchiveHandler(ctx: WorkerContext) {
  return async (job: Job<OutboxJob>) => {
    if (job.name === 'xml-archive-sweep') return sweepAll(ctx);
    const { type, tenantId, payload, correlationId } = job.data;
    if (!tenantId) return;
    if (type === 'xml_archive.test_requested') return testConnection(ctx, tenantId, correlationId);
    if (type === 'xml_archive.retry_requested') return copyPending(ctx, tenantId, correlationId);
    if (type === 'invoice.processed' && typeof payload.invoiceId === 'string') return copyPending(ctx, tenantId, correlationId, payload.invoiceId);
  };
}

async function loadTarget(ctx: WorkerContext, tenantId: string, requireEnabled: boolean): Promise<{ target: ArchiveTarget; template: string; path: string } | { error: string } | null> {
  const s = await ctx.db.run(systemContext(tenantId), (tx) => tx.xmlArchiveSettings.findUnique({ where: { tenantId } }));
  if (!s || !s.path || (requireEnabled && !s.enabled)) return null;
  try {
    const password = s.passwordEnc ? decryptPassword(ctx.env.TWO_FACTOR_ENC_KEY, s.passwordEnc) : null;
    const target = createArchiveTarget(s.path, { domain: s.domain, username: s.username, password }, ctx.env.XML_ARCHIVE_LOCAL_ROOTS);
    return { target, template: s.folderTemplate, path: s.path };
  } catch (err) {
    if (err instanceof ArchiveError) return { error: err.message };
    ctx.logger.error({ err, tenantId }, 'Configuração da pasta de rede ilegível');
    return { error: 'Configuração da pasta de rede ilegível. Informe a senha novamente.' };
  }
}

async function testConnection(ctx: WorkerContext, tenantId: string, correlationId: string | null) {
  const cfg = await loadTarget(ctx, tenantId, false);
  if (!cfg) return;
  let ok = false;
  let message: string;
  if ('error' in cfg) {
    message = cfg.error;
  } else {
    const name = `teste-ordens-${Date.now()}.txt`;
    try {
      await cfg.target.put([], name, Buffer.from('Teste de gravação do Ordens TMS. Pode apagar.\n'));
      await cfg.target.remove([], name);
      ok = true;
      message = 'Gravação e remoção de arquivo de teste concluídas.';
    } catch (err) {
      message = err instanceof ArchiveError ? err.message : 'Falha inesperada ao acessar a pasta.';
      if (!(err instanceof ArchiveError)) ctx.logger.error({ err, tenantId }, 'Teste da pasta de rede');
    }
  }
  const sys = systemContext(tenantId);
  await ctx.db.run(sys, async (tx) => {
    await tx.xmlArchiveSettings.update({ where: { tenantId }, data: { lastTestAt: new Date(), lastTestOk: ok, lastTestMessage: message } });
    await writeAudit(tx, sys, systemMeta(correlationId), { entityType: 'tenant', entityId: tenantId, action: 'tenant.xml_archive_test_result', metadata: { ok, message } });
  });
}

/** Copia as notas pendentes da empresa (ou só uma). Para no primeiro erro de conexão. */
async function copyPending(ctx: WorkerContext, tenantId: string, correlationId: string | null, invoiceId?: string) {
  const cfg = await loadTarget(ctx, tenantId, true);
  if (!cfg) return;
  const sys = systemContext(tenantId);
  const meta = systemMeta(correlationId);
  let cursor: string | undefined;

  for (;;) {
    const rows: InvoiceRow[] = await ctx.db.run(sys, (tx) =>
      tx.invoice.findMany({
        where: { ...PENDING, archiveAttempts: { lt: XML_ARCHIVE_MAX_ATTEMPTS }, ...(invoiceId ? { id: invoiceId } : {}), ...(cursor ? { id: { gt: cursor } } : {}) },
        orderBy: { id: 'asc' },
        take: BATCH,
        select: { id: true, accessKey: true, issuedAt: true, createdAt: true, issuerName: true, issuerDocument: true, recipientDocument: true, fileUploadId: true, archiveAttempts: true },
      }),
    );
    if (!rows.length) return;

    for (const inv of rows) {
      const error = 'error' in cfg ? cfg.error : await copyOne(ctx, sys, cfg, inv);
      if (error === null) {
        continue;
      }
      await ctx.db.run(sys, (tx) => tx.invoice.update({ where: { id: inv.id }, data: { archiveError: error, archiveAttempts: { increment: 1 } } }));
      ctx.logger.warn({ tenantId, invoiceId: inv.id, error }, 'Cópia do XML para a pasta de rede falhou');
      // Destino fora do ar: não insiste nas demais agora (a varredura tenta de novo mais tarde).
      return;
    }
    if (invoiceId || rows.length < BATCH) return;
    cursor = rows.at(-1)!.id;
  }

  async function copyOne(ctx: WorkerContext, sysCtx: typeof sys, c: { target: ArchiveTarget; template: string }, inv: InvoiceRow): Promise<string | null> {
    const upload = inv.fileUploadId ? await ctx.db.run(sysCtx, (tx) => tx.fileUpload.findUnique({ where: { id: inv.fileUploadId! }, select: { bucket: true, objectKey: true } })) : null;
    if (!upload) return 'Arquivo XML original não encontrado.';
    let full: string;
    try {
      const obj = await ctx.s3.send(new GetObjectCommand({ Bucket: upload.bucket, Key: upload.objectKey }));
      const data = Buffer.from(await (obj.Body as { transformToByteArray(): Promise<Uint8Array> }).transformToByteArray());
      const { dirs, name } = archiveLocation(inv, c.template);
      full = await c.target.put(dirs, name, data);
    } catch (err) {
      if (err instanceof ArchiveError) return err.message;
      ctx.logger.error({ err, invoiceId: inv.id }, 'Falha inesperada ao copiar XML');
      return 'Falha inesperada ao copiar o XML.';
    }
    await ctx.db.run(sysCtx, async (tx) => {
      await tx.invoice.update({ where: { id: inv.id }, data: { archivedAt: new Date(), archivePath: full, archiveError: null } });
      await writeAudit(tx, sysCtx, meta, { entityType: 'invoice', entityId: inv.id, action: 'invoice.xml_archived', after: { path: full } });
    });
    return null;
  }
}

/** Varredura periódica: retoma as cópias pendentes das empresas com a cópia ativa. */
async function sweepAll(ctx: WorkerContext) {
  const tenants = await ctx.db.system((tx) => tx.xmlArchiveSettings.findMany({ where: { enabled: true }, select: { tenantId: true } }));
  for (const t of tenants) {
    await copyPending(ctx, t.tenantId, null).catch((err: unknown) => ctx.logger.error({ err, tenantId: t.tenantId }, 'Varredura da pasta de rede'));
  }
}
