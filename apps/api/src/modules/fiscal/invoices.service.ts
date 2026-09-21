import { Injectable } from '@nestjs/common';
import {
  ErrorCode,
  INVOICE_STATUSES,
  type InvoiceDto,
  type InvoiceArchiveInfo,
  type InvoiceIssue,
  type InvoiceListQuery,
  type InvoiceRejectCode,
  type LoadStatus,
  type Page,
} from '@ordens/contracts';
import type { Prisma, Tx } from '@ordens/db';
import { AppError } from '../../common/errors.js';
import { currentAuth } from '../../common/request-context.js';
import { TenantDb } from '../../infra/tenant-db.service.js';
import { toDate } from '../registry/registry.util.js';
import { decimal, oneOf, uniq } from './fiscal.util.js';

type InvoiceRow = NonNullable<Awaited<ReturnType<Tx['invoice']['findUnique']>>>;

/** Até a documentação fiscal ser validada, a Fazenda pode cancelar a própria NF-e (e reenviar). */
const FARM_CAN_CANCEL: LoadStatus[] = ['SCHEDULED', 'CONFIRMED', 'AWAITING_LOADING', 'LOADING', 'LOADED', 'AWAITING_FARM_INVOICE'];
const ACTIVE = ['VALID', 'DIVERGENT'];

@Injectable()
export class InvoicesService {
  constructor(private readonly db: TenantDb) {}

  list(q: InvoiceListQuery): Promise<Page<InvoiceDto>> {
    return this.db.read(async (tx) => {
      const status = oneOf(INVOICE_STATUSES, q.status);
      const digits = q.q?.replace(/\D/g, '') ?? '';
      const where: Prisma.InvoiceWhereInput = {
        ...(status?.length ? { status: { in: status } } : {}),
        ...(q.origin ? { origin: q.origin } : {}),
        ...(q.orderId ? { orderId: q.orderId } : {}),
        ...(q.loadId ? { loadId: q.loadId } : {}),
        ...(q.from || q.to
          ? { createdAt: { ...(q.from ? { gte: toDate(q.from)! } : {}), ...(q.to ? { lt: new Date(toDate(q.to)!.getTime() + 86_400_000) } : {}) } }
          : {}),
        ...(q.q
          ? {
              OR: [
                { number: { contains: q.q } },
                { issuerName: { contains: q.q, mode: 'insensitive' } },
                ...(digits.length >= 4 ? [{ accessKey: { contains: digits } }, { issuerDocument: { contains: digits } }] : []),
              ],
            }
          : {}),
      };
      const [total, rows] = await Promise.all([
        tx.invoice.count({ where }),
        tx.invoice.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      ]);
      return { total, page: q.page, pageSize: q.pageSize, items: await this.toDtos(tx, rows) };
    });
  }

  detail(id: string): Promise<InvoiceDto> {
    return this.db.read((tx) => this.dto(tx, id));
  }

  cancel(id: string, reason: string): Promise<InvoiceDto> {
    const scopeName = currentAuth().membership!.scope;
    return this.db.write(async ({ tx, audit, outbox }) => {
      const row = await tx.invoice.findUnique({ where: { id } });
      if (!row) throw AppError.notFound('NF-e não encontrada.');
      if (!ACTIVE.includes(row.status)) throw AppError.domain(ErrorCode.INVALID_TRANSITION, 'Somente notas válidas ou com divergência podem ser canceladas.');
      const load = await tx.load.findUniqueOrThrow({ where: { id: row.loadId }, select: { status: true, number: true } });
      if (scopeName !== 'MATRIZ') {
        if (row.origin !== 'FARM') throw AppError.forbidden('Somente a Matriz cancela notas da Matriz.');
        if (!FARM_CAN_CANCEL.includes(load.status)) {
          throw AppError.domain(ErrorCode.INVALID_TRANSITION, 'Após o faturamento da carga, somente a Matriz pode cancelar a NF-e.');
        }
      }
      await tx.invoice.update({ where: { id }, data: { status: 'CANCELLED', cancelReason: reason } });
      await audit({ entityType: 'invoice', entityId: id, action: 'invoice.cancelled', before: { status: row.status }, after: { status: 'CANCELLED', reason } });
      await audit({
        entityType: 'loading_order',
        entityId: row.orderId,
        action: 'order.invoice_cancelled',
        after: { loadNumber: load.number, number: row.number, statusLabel: 'Cancelada' },
      });
      await outbox({ type: 'invoice.cancelled', aggregateType: 'invoice', aggregateId: id, payload: { invoiceId: id, loadId: row.loadId, orderId: row.orderId } });
      return this.dto(tx, id);
    });
  }

  // ───────────────────────────── Internos ─────────────────────────────

  private async dto(tx: Tx, id: string): Promise<InvoiceDto> {
    const row = await tx.invoice.findUnique({ where: { id } });
    if (!row) throw AppError.notFound('NF-e não encontrada.');
    return (await this.toDtos(tx, [row]))[0]!;
  }

  private async toDtos(tx: Tx, rows: InvoiceRow[]): Promise<InvoiceDto[]> {
    if (!rows.length) return [];
    const auth = currentAuth();
    const scopeName = auth.membership!.scope;
    const canUpload = auth.permissions.has('invoice.upload');
    const [loads, orders] = await Promise.all([
      tx.load.findMany({ where: { id: { in: uniq(rows.map((r) => r.loadId)) } }, select: { id: true, number: true, plates: true, status: true } }),
      tx.loadingOrder.findMany({ where: { id: { in: uniq(rows.map((r) => r.orderId)) } }, select: { id: true, number: true } }),
    ]);
    const loadById = new Map(loads.map((l) => [l.id, l]));
    // Cópia na pasta de rede: só a Matriz vê (o caminho é da rede interna da empresa).
    const archiveOn =
      scopeName === 'MATRIZ' &&
      Boolean(await tx.xmlArchiveSettings.findUnique({ where: { tenantId: auth.membership!.tenantId }, select: { enabled: true } }).then((a) => a?.enabled));
    const orderNumbers = new Map(orders.map((o) => [o.id, o.number]));

    return rows.map((r) => {
      const load = loadById.get(r.loadId);
      const active = ACTIVE.includes(r.status);
      return {
        id: r.id,
        load: { id: r.loadId, number: load?.number ?? '', plates: load?.plates ?? [] },
        order: { id: r.orderId, number: orderNumbers.get(r.orderId) ?? '' },
        origin: r.origin,
        status: r.status,
        accessKey: r.accessKey,
        number: r.number,
        series: r.series,
        issuedAt: r.issuedAt?.toISOString() ?? null,
        issuer: { document: r.issuerDocument, name: r.issuerName },
        recipient: { document: r.recipientDocument, name: r.recipientName },
        totalValue: decimal(r.totalValue),
        netWeightKg: decimal(r.netWeightKg),
        grossWeightKg: decimal(r.grossWeightKg),
        quantity: decimal(r.quantity),
        quantityUnit: r.quantityUnit,
        productDescription: r.productDescription,
        plate: r.plate,
        protocolStatus: r.protocolStatus,
        divergences: Array.isArray(r.divergences) ? (r.divergences as unknown as InvoiceIssue[]) : [],
        rejectReason: (r.rejectReason as InvoiceRejectCode | null) ?? null,
        cancelReason: r.cancelReason,
        fileUploadId: r.fileUploadId,
        createdAt: r.createdAt.toISOString(),
        archive: scopeName === 'MATRIZ' ? archiveInfo(r, archiveOn) : null,
        canCancel:
          canUpload &&
          active &&
          (scopeName === 'MATRIZ' || (scopeName === 'FARM' && r.origin === 'FARM' && Boolean(load && FARM_CAN_CANCEL.includes(load.status)))),
      };
    });
  }
}

function archiveInfo(r: InvoiceRow, enabled: boolean): InvoiceArchiveInfo | null {
  if (r.archivedAt) return { status: 'COPIED', at: r.archivedAt.toISOString(), path: r.archivePath, error: null };
  if (r.origin !== 'FARM' || !['VALID', 'DIVERGENT'].includes(r.status) || (!enabled && !r.archiveError)) return null;
  return { status: r.archiveError ? 'FAILED' : 'PENDING', at: null, path: null, error: r.archiveError };
}
