import { Controller, Get, Injectable, Module, Param, Query, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  REPORT_EXPORT_LIMIT,
  REPORT_INFO,
  REPORT_MAX_DAYS,
  REPORT_PDF_LIMIT,
  REPORT_PREVIEW_LIMIT,
  reportFormatSchema,
  reportKindSchema,
  reportQuerySchema,
  type ReportFormat,
  type ReportKind,
  type ReportQuery,
  type ReportResult,
} from '@ordens/contracts';
import { Prisma, type Tx } from '@ordens/db';
import type { Response } from 'express';
import { RequirePermission } from '../../common/decorators.js';
import { AppError } from '../../common/errors.js';
import { ZodPipe } from '../../common/zod.pipe.js';
import { TenantDb } from '../../infra/tenant-db.service.js';
import { toCsv } from './csv.js';
import { toPdf } from './pdf.js';
import { REPORTS, TZ } from './reports.definitions.js';
import { toXlsx } from './xlsx.js';

const CONTENT_TYPES: Record<ReportFormat, string> = {
  csv: 'text/csv; charset=utf-8',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pdf: 'application/pdf',
};

const DAY = 86_400_000;
const todayInTz = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
const shift = (day: string, delta: number) => new Date(new Date(`${day}T00:00:00Z`).getTime() + delta * DAY).toISOString().slice(0, 10);

function normalize(v: unknown, type: string): string | number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'bigint') return Number(v);
  if (typeof v === 'boolean') return v ? 'Sim' : 'Não';
  if (Prisma.Decimal.isDecimal(v)) return new Prisma.Decimal(v as Prisma.Decimal).toString();
  if (v instanceof Date) return type === 'date' ? v.toISOString().slice(0, 10) : v.toISOString();
  return typeof v === 'number' ? v : String(v);
}

@Injectable()
export class ReportsService {
  constructor(private readonly db: TenantDb) {}

  /** Período padrão: últimos 30 dias até hoje (fuso operacional). */
  private period(q: ReportQuery) {
    const to = q.to ?? todayInTz();
    const from = q.from ?? shift(to, -29);
    const days = (new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / DAY + 1;
    if (days < 1) throw AppError.validation({ fields: { from: ['A data inicial deve ser anterior à final'] } });
    if (days > REPORT_MAX_DAYS) throw AppError.validation({ fields: { from: [`Período máximo de ${REPORT_MAX_DAYS} dias`] } });
    return { from, to };
  }

  private async run(tx: Tx, kind: ReportKind, q: ReportQuery, limit: number): Promise<ReportResult> {
    const def = REPORTS[kind];
    const { from, to } = this.period(q);
    const raw = await tx.$queryRaw<Record<string, unknown>[]>(def.sql({ from, to, commodityId: q.commodityId, limit }));
    const total = raw.length ? Number(raw[0]!.total_count) : 0;
    return {
      kind,
      label: REPORT_INFO[kind].label,
      from,
      to,
      columns: def.columns.map(({ key, label, type }) => ({ key, label, type })),
      rows: raw.map((r) =>
        def.columns.map((c) => {
          const value = normalize(r[c.key], c.type);
          return c.labels && typeof value === 'string' ? (c.labels[value] ?? value) : value;
        }),
      ),
      total,
      truncated: total > raw.length,
      generatedAt: new Date().toISOString(),
    };
  }

  preview(kind: ReportKind, q: ReportQuery): Promise<ReportResult> {
    return this.db.read((tx) => this.run(tx, kind, q, REPORT_PREVIEW_LIMIT));
  }

  /** Exportação completa (até o limite do formato), auditada na mesma transação da leitura. */
  export(kind: ReportKind, q: ReportQuery, format: ReportFormat): Promise<{ body: string | Buffer; filename: string; contentType: string; result: ReportResult }> {
    return this.db.write(async (scope) => {
      const result = await this.run(scope.tx, kind, q, format === 'pdf' ? REPORT_PDF_LIMIT : REPORT_EXPORT_LIMIT);
      await scope.audit({
        entityType: 'report',
        entityId: null,
        action: 'report.exported',
        after: {
          kind,
          format,
          label: result.label,
          from: result.from,
          to: result.to,
          commodityId: q.commodityId ?? null,
          rows: result.rows.length,
          total: result.total,
        },
      });
      const body = format === 'xlsx' ? await toXlsx(result) : format === 'pdf' ? await toPdf(result) : toCsv(result.columns, result.rows);
      return { body, filename: `relatorio-${kind}-${result.from}-a-${result.to}.${format}`, contentType: CONTENT_TYPES[format], result };
    });
  }
}

@ApiTags('relatórios')
@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get(':kind')
  @RequirePermission('report.export')
  preview(@Param('kind', new ZodPipe(reportKindSchema)) kind: ReportKind, @Query(new ZodPipe(reportQuerySchema)) q: ReportQuery) {
    return this.reports.preview(kind, q);
  }

  @Get(':kind/export')
  @RequirePermission('report.export')
  async export(
    @Param('kind', new ZodPipe(reportKindSchema)) kind: ReportKind,
    @Query(new ZodPipe(reportQuerySchema)) q: ReportQuery,
    @Query('format', new ZodPipe(reportFormatSchema)) format: ReportFormat,
    @Res() res: Response,
  ) {
    const { body, filename, contentType, result } = await this.reports.export(kind, q, format);
    res.setHeader('content-type', contentType);
    res.setHeader('content-disposition', `attachment; filename="${filename}"`);
    res.setHeader('cache-control', 'no-store');
    res.setHeader('x-report-rows', String(result.rows.length));
    res.setHeader('x-report-truncated', String(result.truncated));
    res.send(body);
  }
}

@Module({
  controllers: [ReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}
