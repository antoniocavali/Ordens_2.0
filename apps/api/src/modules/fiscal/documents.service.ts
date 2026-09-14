import { Injectable } from '@nestjs/common';
import {
  DOCUMENT_KINDS,
  type DocumentDto,
  type DocumentListQuery,
  type DocumentVisibility,
  type Page,
  type UploadStatus,
} from '@ordens/contracts';
import type { Prisma, Tx } from '@ordens/db';
import { AppError } from '../../common/errors.js';
import { currentAuth } from '../../common/request-context.js';
import { TenantDb } from '../../infra/tenant-db.service.js';
import { oneOf, uniq } from './fiscal.util.js';

type UploadRow = NonNullable<Awaited<ReturnType<Tx['fileUpload']['findUnique']>>>;

/** Envios não concluídos não aparecem na central. */
const HIDDEN: UploadStatus[] = ['PENDING', 'UPLOADING', 'ABORTED', 'EXPIRED'];
/** Só documentos de ordem, carga e ocorrência têm partes externas com quem compartilhar. */
const SHAREABLE = ['loading_order', 'load', 'occurrence'];

@Injectable()
export class DocumentsService {
  constructor(private readonly db: TenantDb) {}

  list(q: DocumentListQuery): Promise<Page<DocumentDto>> {
    return this.db.read(async (tx) => {
      const kinds = oneOf(DOCUMENT_KINDS, q.kind);
      const where: Prisma.FileUploadWhereInput = {
        status: { notIn: HIDDEN },
        entityType: q.entityType ?? { not: 'user' },
        ...(q.entityId ? { entityId: q.entityId } : {}),
        ...(kinds?.length ? { kind: { in: kinds } } : {}),
        ...(q.visibility ? { visibility: q.visibility } : {}),
        ...(q.q ? { originalName: { contains: q.q, mode: 'insensitive' } } : {}),
      };
      const [total, rows] = await Promise.all([
        tx.fileUpload.count({ where }),
        tx.fileUpload.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      ]);
      return { total, page: q.page, pageSize: q.pageSize, items: await this.toDtos(tx, rows) };
    });
  }

  setVisibility(id: string, visibility: DocumentVisibility): Promise<DocumentDto> {
    if (currentAuth().membership!.scope !== 'MATRIZ') throw AppError.forbidden('Somente a Matriz altera a visibilidade de documentos.');
    return this.db.write(async ({ tx, audit }) => {
      const row = await tx.fileUpload.findUnique({ where: { id } });
      if (!row || HIDDEN.includes(row.status)) throw AppError.notFound('Documento não encontrado.');
      if (visibility !== 'INTERNAL' && !SHAREABLE.includes(row.entityType)) {
        const message = 'Documentos de cadastros e contratos são sempre internos.';
        throw AppError.validation({ fields: { visibility: [message] } }, message);
      }
      if (row.visibility !== visibility) {
        await tx.fileUpload.update({ where: { id }, data: { visibility } });
        await audit({ entityType: 'file_upload', entityId: id, action: 'document.visibility_changed', before: { visibility: row.visibility }, after: { visibility } });
      }
      return (await this.toDtos(tx, [{ ...row, visibility }]))[0]!;
    });
  }

  private async toDtos(tx: Tx, rows: UploadRow[]): Promise<DocumentDto[]> {
    if (!rows.length) return [];
    const auth = currentAuth();
    const canChange = auth.membership!.scope === 'MATRIZ' && auth.permissions.has('document.upload');
    const idsOf = (type: string) => uniq(rows.filter((r) => r.entityType === type).map((r) => r.entityId));

    const [orders, loads, occurrences, contracts, partners, farms, users, orgs, invoices] = await Promise.all([
      tx.loadingOrder.findMany({ where: { id: { in: idsOf('loading_order') } }, select: { id: true, number: true } }),
      tx.load.findMany({ where: { id: { in: idsOf('load') } }, select: { id: true, number: true, orderId: true } }),
      tx.occurrence.findMany({ where: { id: { in: idsOf('occurrence') } }, select: { id: true, number: true, orderId: true } }),
      tx.contract.findMany({ where: { id: { in: idsOf('contract') } }, select: { id: true, number: true } }),
      tx.businessPartner.findMany({ where: { id: { in: idsOf('partner') } }, select: { id: true, legalName: true, tradeName: true } }),
      tx.farm.findMany({ where: { id: { in: idsOf('farm') } }, select: { id: true, name: true } }),
      tx.user.findMany({ where: { id: { in: uniq(rows.map((r) => r.createdBy)) } }, select: { id: true, name: true } }),
      tx.organization.findMany({ where: { id: { in: uniq(rows.map((r) => r.organizationId)) } }, select: { id: true, name: true } }),
      tx.invoice.findMany({ where: { fileUploadId: { in: rows.map((r) => r.id) } }, select: { fileUploadId: true, status: true } }),
    ]);

    const parentIds = uniq([...loads.map((l) => l.orderId), ...occurrences.map((o) => o.orderId)]).filter((id) => !orders.some((o) => o.id === id));
    const parents = parentIds.length ? await tx.loadingOrder.findMany({ where: { id: { in: parentIds } }, select: { id: true, number: true } }) : [];
    const orderNumbers = new Map([...orders, ...parents].map((o) => [o.id, o.number]));

    const labels = new Map<string, { label: string; orderId: string | null }>([
      ...orders.map((o) => [o.id, { label: `OC ${o.number}`, orderId: o.id }] as const),
      ...loads.map((l) => [l.id, { label: `Carga ${l.number}`, orderId: l.orderId }] as const),
      ...occurrences.map((o) => [o.id, { label: `Ocorrência ${o.number}`, orderId: o.orderId }] as const),
      ...contracts.map((c) => [c.id, { label: `Contrato ${c.number}`, orderId: null }] as const),
      ...partners.map((p) => [p.id, { label: p.tradeName ?? p.legalName, orderId: null }] as const),
      ...farms.map((f) => [f.id, { label: f.name, orderId: null }] as const),
    ]);
    const names = new Map(users.map((u) => [u.id, u.name]));
    const orgNames = new Map(orgs.map((o) => [o.id, o.name]));
    const invoiceStatus = new Map(invoices.map((i) => [i.fileUploadId, i.status]));

    return rows.map((r) => {
      const entity = labels.get(r.entityId);
      const orderId = entity?.orderId ?? null;
      return {
        id: r.id,
        kind: r.kind,
        fileName: r.originalName,
        sizeBytes: r.sizeBytes.toString(),
        status: r.status,
        scanStatus: r.scanStatus,
        visibility: r.visibility,
        entity: { type: r.entityType, id: r.entityId, label: entity?.label ?? null },
        order: orderId ? { id: orderId, number: orderNumbers.get(orderId) ?? '' } : null,
        uploadedBy: names.get(r.createdBy) ?? null,
        organization: orgNames.get(r.organizationId) ?? null,
        invoiceStatus: invoiceStatus.get(r.id) ?? null,
        createdAt: r.createdAt.toISOString(),
        canChangeVisibility: canChange && SHAREABLE.includes(r.entityType),
      };
    });
  }
}
