import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';
import { Inject, Injectable } from '@nestjs/common';
import {
  ErrorCode,
  MULTIPART_PART_SIZE,
  SINGLE_UPLOAD_MAX_BYTES,
  SUPPORT_ATTACHMENT_MAX_BYTES,
  SUPPORT_ATTACHMENT_MIMES,
  UPLOAD_RULES,
  type InitiateUploadInput,
  type InitiateUploadResponse,
  type LoadStatus,
  type UploadDto,
} from '@ordens/contracts';
import type { Tx } from '@ordens/db';
import { ENV, type Env } from '../../config/env.js';
import { AppError } from '../../common/errors.js';
import { currentAuth } from '../../common/request-context.js';
import { StorageService } from '../../infra/storage.service.js';
import { TenantDb } from '../../infra/tenant-db.service.js';

type UploadRecord = NonNullable<Awaited<ReturnType<Tx['fileUpload']['findUnique']>>>;

const MAX_PARTS = 10_000;

/**
 * Fora da Matriz, corrigir um anexo só vale enquanto a documentação fiscal não foi validada — a mesma
 * régua do cancelamento da NF-e (ver invoices.service). Depois disso, só a Matriz mexe.
 */
const EXTERNAL_CAN_REMOVE: LoadStatus[] = ['SCHEDULED', 'CONFIRMED', 'AWAITING_LOADING', 'LOADING', 'LOADED', 'AWAITING_FARM_INVOICE'];
/** Envio em andamento não se remove: cancela-se (abort), que também libera o multipart no storage. */
const IN_FLIGHT = ['PENDING', 'UPLOADING'];

function toDto(u: UploadRecord, uploadedParts?: { partNumber: number; etag: string }[], removedByName?: string | null): UploadDto {
  return {
    id: u.id,
    entityType: u.entityType,
    entityId: u.entityId,
    kind: u.kind,
    fileName: u.originalName,
    sizeBytes: u.sizeBytes.toString(),
    mimeType: u.declaredMime,
    status: u.status,
    scanStatus: u.scanStatus,
    sha256: u.sha256Actual ?? u.sha256Declared,
    createdAt: u.createdAt.toISOString(),
    removedAt: u.removedAt?.toISOString() ?? null,
    removedBy: removedByName ?? null,
    removeReason: u.removeReason,
    ...(uploadedParts ? { uploadedParts } : {}),
  };
}

/**
 * Upload direto navegador → storage. A API autoriza, registra e finaliza; o arquivo nunca passa por aqui.
 * Processamento (checksum, magic bytes, antivírus, promoção) acontece no worker via outbox.
 */
@Injectable()
export class UploadsService {
  constructor(
    private readonly db: TenantDb,
    private readonly storage: StorageService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async initiate(input: InitiateUploadInput): Promise<InitiateUploadResponse> {
    const auth = currentAuth();
    const m = auth.membership!;
    this.validateFile(input);
    if (input.entityType === 'support_conversation') {
      if (input.kind !== 'IMAGE' || !SUPPORT_ATTACHMENT_MIMES.includes(input.mimeType as (typeof SUPPORT_ATTACHMENT_MIMES)[number])) {
        throw AppError.domain(ErrorCode.UPLOAD_REJECTED, 'No atendimento só é possível anexar imagem PNG, JPEG ou WebP.', { fields: { mimeType: ['Imagem PNG, JPEG ou WebP'] } });
      }
      if (input.sizeBytes > SUPPORT_ATTACHMENT_MAX_BYTES) {
        throw AppError.domain(ErrorCode.UPLOAD_REJECTED, 'A imagem do atendimento deve ter no máximo 10 MB.', { fields: { sizeBytes: ['Máximo de 10 MB'] } });
      }
    }
    if (input.kind === 'NFE_XML') {
      if (input.entityType !== 'load') {
        throw AppError.domain(ErrorCode.UPLOAD_REJECTED, 'A NF-e (XML) deve ser anexada a uma carga.', { fields: { entityType: ['Anexe na carga'] } });
      }
      if (!auth.permissions.has('invoice.upload')) throw AppError.forbidden('Você não tem permissão para enviar NF-e.');
    }

    const existing = await this.db.read(async (tx) => {
      await this.assertEntityVisible(tx, input.entityType, input.entityId);
      return tx.fileUpload.findUnique({ where: { tenantId_idempotencyKey: { tenantId: m.tenantId, idempotencyKey: input.idempotencyKey } } });
    });
    if (existing) return this.resume(existing);

    const now = new Date();
    const objectKey = `t/${m.tenantId}/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${randomUUID()}`;
    const bucket = this.storage.quarantineBucket;
    const multipart = input.sizeBytes > SINGLE_UPLOAD_MAX_BYTES;
    // I/O externo fora da transação.
    const multipartId = multipart ? await this.storage.createMultipart(bucket, objectKey, input.mimeType) : null;

    const record = await this.db.write(async (scope) => {
      // Nota da carga (PDF ou XML): a da Fazenda é só dela; a que a Matriz emite é só do Comprador.
      // Enviada pela Fazenda, é dela. Enviada pela Matriz, é a nota da Fazenda (anexada em nome dela)
      // enquanto a carga não saiu para transporte, e a nota da Matriz depois — mesmo critério do
      // checklist. Para o XML, o worker confirma pela origem lida na própria nota.
      let fiscalVisibility: 'FARM' | 'BUYER' | null = null;
      if (input.entityType === 'load' && (input.kind === 'PDF' || input.kind === 'NFE_XML')) {
        const inTransit =
          m.scope === 'FARM' ? null : await scope.tx.loadStatusHistory.findFirst({ where: { loadId: input.entityId, toStatus: 'IN_TRANSIT' }, select: { id: true } });
        fiscalVisibility = inTransit ? 'BUYER' : 'FARM';
      }
      const created = await scope.tx.fileUpload.create({
        data: {
          tenantId: m.tenantId,
          organizationId: m.organizationId,
          entityType: input.entityType,
          entityId: input.entityId,
          kind: input.kind,
          originalName: input.fileName,
          declaredMime: input.mimeType,
          sizeBytes: BigInt(input.sizeBytes),
          bucket,
          objectKey,
          multipartId,
          sha256Declared: input.sha256 ?? null,
          status: multipart ? 'UPLOADING' : 'PENDING',
          idempotencyKey: input.idempotencyKey,
          // Q18: o que a Fazenda envia ela compartilha com a Matriz; o que a Matriz envia fica interno até ela
          // decidir compartilhar; cadastros sempre internos. Notas da carga seguem a regra acima.
          visibility: !['loading_order', 'load', 'occurrence'].includes(input.entityType) ? 'INTERNAL' : (fiscalVisibility ?? (m.scope === 'FARM' ? 'FARM' : 'INTERNAL')),
          createdBy: auth.userId,
        },
      });
      await scope.audit({
        entityType: 'file_upload',
        entityId: created.id,
        action: 'upload.initiated',
        after: { entityType: input.entityType, entityId: input.entityId, kind: input.kind, fileName: input.fileName, sizeBytes: input.sizeBytes },
      });
      return created;
    });
    return this.resume(record);
  }

  async partUrls(id: string, partNumbers: number[]): Promise<{ parts: { partNumber: number; url: string }[] }> {
    const upload = await this.get(id);
    if (!upload.multipartId || upload.status !== 'UPLOADING') {
      throw AppError.domain(ErrorCode.UPLOAD_REJECTED, 'Este envio não aceita novas partes.');
    }
    const maxPart = Math.ceil(Number(upload.sizeBytes) / MULTIPART_PART_SIZE);
    if (partNumbers.some((n) => n > maxPart)) throw AppError.validation({ fields: { partNumbers: ['Parte fora do intervalo'] } });
    const parts = await Promise.all(
      partNumbers.map(async (partNumber) => ({
        partNumber,
        url: await this.storage.presignPart(upload.bucket, upload.objectKey, upload.multipartId!, partNumber),
      })),
    );
    return { parts };
  }

  async status(id: string): Promise<UploadDto> {
    const upload = await this.get(id);
    const parts =
      upload.multipartId && upload.status === 'UPLOADING'
        ? await this.storage.listParts(upload.bucket, upload.objectKey, upload.multipartId)
        : undefined;
    return toDto(upload, parts);
  }

  async complete(id: string, parts?: { partNumber: number; etag: string }[]): Promise<UploadDto> {
    const upload = await this.get(id);
    if (['UPLOADED', 'PROCESSING', 'AVAILABLE'].includes(upload.status)) return toDto(upload); // idempotente
    if (!['PENDING', 'UPLOADING'].includes(upload.status)) {
      throw AppError.domain(ErrorCode.UPLOAD_REJECTED, 'Este envio não pode mais ser concluído.');
    }

    if (upload.multipartId) {
      if (!parts?.length) throw AppError.validation({ fields: { parts: ['Informe as partes enviadas'] } });
      await this.storage.completeMultipart(upload.bucket, upload.objectKey, upload.multipartId, parts);
    }
    const head = await this.storage.head(upload.bucket, upload.objectKey);
    if (!head) throw AppError.domain(ErrorCode.UPLOAD_REJECTED, 'O arquivo não chegou ao armazenamento. Tente enviar novamente.');
    if (BigInt(head.size) !== upload.sizeBytes) {
      await this.markRejected(upload, 'size_mismatch');
      throw AppError.domain(ErrorCode.UPLOAD_REJECTED, 'O tamanho recebido difere do informado. Envie o arquivo novamente.');
    }

    const updated = await this.db.write(async (scope) => {
      const row = await scope.tx.fileUpload.update({
        where: { id: upload.id },
        data: { status: 'UPLOADED', completedAt: new Date() },
      });
      await scope.audit({ entityType: 'file_upload', entityId: upload.id, action: 'upload.completed', after: { sizeBytes: head.size } });
      // Documentos fiscais da carga entram na linha do tempo da ordem.
      if (upload.entityType === 'load' && (upload.kind === 'PDF' || upload.kind === 'NFE_XML')) {
        const load = await scope.tx.load.findUnique({ where: { id: upload.entityId }, select: { orderId: true, number: true } });
        if (load) {
          await scope.audit({
            entityType: 'loading_order',
            entityId: load.orderId,
            action: 'order.load_document_attached',
            after: { loadNumber: load.number, statusLabel: upload.kind === 'PDF' ? 'PDF da nota fiscal' : 'XML da NF-e', number: upload.originalName },
          });
        }
      }
      await scope.outbox({
        type: 'upload.completed',
        aggregateType: 'file_upload',
        aggregateId: upload.id,
        payload: { uploadId: upload.id, tenantId: upload.tenantId, kind: upload.kind, entityType: upload.entityType, entityId: upload.entityId },
      });
      return row;
    });
    return toDto(updated);
  }

  async abort(id: string): Promise<void> {
    const upload = await this.get(id);
    if (!['PENDING', 'UPLOADING'].includes(upload.status)) return;
    if (upload.multipartId) {
      await this.storage.abortMultipart(upload.bucket, upload.objectKey, upload.multipartId).catch(() => undefined);
    }
    await this.db.write(async (scope) => {
      await scope.tx.fileUpload.update({ where: { id }, data: { status: 'ABORTED' } });
      await scope.audit({ entityType: 'file_upload', entityId: id, action: 'upload.aborted' });
    });
  }

  async list(entityType: string, entityId: string): Promise<UploadDto[]> {
    return this.db.read(async (tx) => {
      const rows = await tx.fileUpload.findMany({
        where: { entityType, entityId, status: { notIn: ['ABORTED', 'EXPIRED'] } },
        orderBy: { createdAt: 'desc' },
        take: 200,
      });
      // Removidos continuam na lista, marcados e com o motivo: quem confere precisa ver que o arquivo
      // saiu e por quê, em vez de ele simplesmente desaparecer da tela.
      const removedBy = [...new Set(rows.map((r) => r.removedBy).filter((v): v is string => Boolean(v)))];
      const users = removedBy.length ? await tx.user.findMany({ where: { id: { in: removedBy } }, select: { id: true, name: true } }) : [];
      const names = new Map(users.map((u) => [u.id, u.name]));
      return rows.map((r) => toDto(r, undefined, r.removedBy ? (names.get(r.removedBy) ?? null) : null));
    });
  }

  /**
   * Tira o arquivo da conferência fiscal sem apagar o rastro: o registro fica como REMOVED com autor,
   * data e motivo, e o objeto permanece no storage. Se o XML já tinha virado NF-e, ela é cancelada
   * junto — senão o checklist continuaria contando uma nota de um arquivo que ninguém mais vê.
   */
  async remove(id: string, reason: string): Promise<UploadDto> {
    const auth = currentAuth();
    const upload = await this.get(id);
    if (upload.status === 'REMOVED') throw AppError.domain(ErrorCode.INVALID_TRANSITION, 'Este arquivo já foi removido.');
    if (IN_FLIGHT.includes(upload.status)) {
      throw AppError.domain(ErrorCode.INVALID_TRANSITION, 'O envio ainda está em andamento: cancele o envio em vez de remover.');
    }

    return this.db.write(async ({ tx, audit, outbox }) => {
      const load = upload.entityType === 'load' ? await tx.load.findUnique({ where: { id: upload.entityId }, select: { id: true, number: true, status: true, orderId: true } }) : null;
      if (load) {
        if (['COMPLETED', 'CANCELLED'].includes(load.status)) {
          throw AppError.domain(ErrorCode.INVALID_TRANSITION, 'A carga já foi encerrada: os documentos dela não podem mais ser removidos.');
        }
        if (auth.membership!.scope !== 'MATRIZ' && !EXTERNAL_CAN_REMOVE.includes(load.status)) {
          throw AppError.domain(ErrorCode.INVALID_TRANSITION, 'Após o envio para transporte, somente a Matriz remove documentos desta carga.');
        }
      }

      await tx.fileUpload.update({ where: { id }, data: { status: 'REMOVED', removedAt: new Date(), removedBy: auth.userId, removeReason: reason } });

      const invoice = await tx.invoice.findFirst({ where: { fileUploadId: id }, select: { id: true, status: true, number: true, orderId: true } });
      if (invoice && ['VALID', 'DIVERGENT'].includes(invoice.status)) {
        await tx.invoice.update({ where: { id: invoice.id }, data: { status: 'CANCELLED', cancelReason: `Arquivo removido: ${reason}` } });
        await audit({ entityType: 'invoice', entityId: invoice.id, action: 'invoice.cancelled', before: { status: invoice.status }, after: { status: 'CANCELLED', reason } });
      }

      await audit({
        entityType: 'file_upload',
        entityId: id,
        action: 'upload.removed',
        before: { status: upload.status },
        after: { status: 'REMOVED', reason, fileName: upload.originalName },
      });
      if (load) {
        await audit({
          entityType: 'loading_order',
          entityId: load.orderId,
          action: 'order.load_document_removed',
          after: { loadNumber: load.number, fileName: upload.originalName, reason },
        });
        await outbox({ type: 'upload.removed', aggregateType: 'file_upload', aggregateId: id, payload: { uploadId: id, loadId: load.id, orderId: load.orderId, reason } });
      }
      const fresh = await tx.fileUpload.findUniqueOrThrow({ where: { id } });
      return toDto(fresh, undefined, auth.userName);
    });
  }

  async downloadUrl(id: string): Promise<{ url: string; expiresInSeconds: number }> {
    const upload = await this.get(id);
    if (upload.status !== 'AVAILABLE') {
      throw AppError.domain(ErrorCode.UPLOAD_REJECTED, 'O documento ainda está sendo processado.');
    }
    await this.db.write((scope) =>
      scope.audit({ entityType: 'file_upload', entityId: id, action: 'document.downloaded', metadata: { kind: upload.kind } }),
    );
    const url = await this.storage.presignGet(upload.bucket, upload.objectKey, upload.originalName, 60);
    return { url, expiresInSeconds: 60 };
  }

  // ───────────────────────────── Internos ─────────────────────────────

  private validateFile(input: InitiateUploadInput) {
    const rule = UPLOAD_RULES[input.kind];
    const ext = extname(input.fileName).toLowerCase();
    const max = Math.min(rule.maxBytes, this.env.UPLOAD_MAX_BYTES);
    const errors: string[] = [];
    if (!rule.extensions.includes(ext)) errors.push(`Extensão ${ext || '(nenhuma)'} não permitida`);
    if (!rule.mimes.includes(input.mimeType)) errors.push('Tipo de arquivo não permitido');
    if (input.sizeBytes > max) errors.push(`Arquivo acima do limite de ${Math.floor(max / 1024 / 1024)} MB`);
    if (Math.ceil(input.sizeBytes / MULTIPART_PART_SIZE) > MAX_PARTS) errors.push('Arquivo grande demais');
    if (errors.length) throw AppError.domain(ErrorCode.UPLOAD_REJECTED, errors[0]!, { fields: { file: errors } });
  }

  private async assertEntityVisible(tx: Tx, entityType: string, entityId: string) {
    const auth = currentAuth();
    let found: unknown;
    switch (entityType) {
      case 'loading_order':
        found = await tx.loadingOrder.findUnique({ where: { id: entityId }, select: { id: true } });
        break;
      case 'partner':
        found = await tx.businessPartner.findUnique({ where: { id: entityId }, select: { id: true } });
        break;
      case 'farm':
        found = await tx.farm.findUnique({ where: { id: entityId }, select: { id: true } });
        break;
      case 'load':
        found = await tx.load.findUnique({ where: { id: entityId }, select: { id: true } });
        break;
      case 'occurrence':
        found = await tx.occurrence.findUnique({ where: { id: entityId }, select: { id: true } });
        break;
      case 'user':
        found = entityId === auth.userId ? { id: entityId } : null;
        break;
      case 'support_conversation':
        // A RLS de support_conversations já limita ao solicitante ou ao atendimento.
        found = await tx.supportConversation.findUnique({ where: { id: entityId }, select: { id: true } });
        break;
      default:
        throw AppError.domain(ErrorCode.UPLOAD_REJECTED, 'Tipo de vínculo ainda não suportado.');
    }
    if (!found) throw AppError.notFound('Registro vinculado não encontrado.');
  }

  private async resume(upload: UploadRecord): Promise<InitiateUploadResponse> {
    const expiresAt = new Date(Date.now() + 15 * 60_000).toISOString();
    if (upload.multipartId) {
      return {
        uploadId: upload.id,
        strategy: 'MULTIPART',
        partSize: MULTIPART_PART_SIZE,
        partCount: Math.ceil(Number(upload.sizeBytes) / MULTIPART_PART_SIZE),
        expiresAt,
      };
    }
    if (upload.status !== 'PENDING') return { uploadId: upload.id, strategy: 'SINGLE', expiresAt };
    const url = await this.storage.presignPut(upload.bucket, upload.objectKey, upload.declaredMime, Number(upload.sizeBytes));
    return { uploadId: upload.id, strategy: 'SINGLE', url, headers: { 'Content-Type': upload.declaredMime }, expiresAt };
  }

  /**
   * Apaga o arquivo do storage e marca o registro. Diferente de `remove`, que preserva o objeto: aqui o
   * conteúdo precisa sumir mesmo (captura de tela pode trazer dado pessoal de terceiros).
   */
  async purgeObject(id: string, reason: string, actorUserId: string | null): Promise<void> {
    const upload = await this.get(id);
    if (upload.status === 'REMOVED') return;
    await this.storage.deleteObject(upload.bucket, upload.objectKey).catch(() => undefined);
    await this.db.write(async ({ tx, audit }) => {
      await tx.fileUpload.update({ where: { id }, data: { status: 'REMOVED', removedAt: new Date(), removedBy: actorUserId, removeReason: reason } });
      await audit({ entityType: 'file_upload', entityId: id, action: 'upload.purged', before: { status: upload.status }, after: { reason, fileName: upload.originalName } });
    });
  }

  private async get(id: string): Promise<UploadRecord> {
    const upload = await this.db.read((tx) => tx.fileUpload.findUnique({ where: { id } }));
    if (!upload) throw AppError.notFound('Envio não encontrado.');
    return upload;
  }

  private async markRejected(upload: UploadRecord, reason: string) {
    await this.db.write(async (scope) => {
      await scope.tx.fileUpload.update({ where: { id: upload.id }, data: { status: 'REJECTED', rejectReason: reason } });
      await scope.audit({ entityType: 'file_upload', entityId: upload.id, action: 'upload.rejected', metadata: { reason } });
    });
  }
}
