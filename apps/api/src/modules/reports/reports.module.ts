import { Body, Controller, Get, Injectable, Module, Param, ParseUUIDPipe, Post, Query, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  createReportJobSchema,
  REPORT_EXPORT_LIMIT,
  REPORT_INFO,
  REPORT_PDF_LIMIT,
  REPORT_PREVIEW_LIMIT,
  reportFormatSchema,
  reportKindSchema,
  reportQuerySchema,
  type CreateReportJobInput,
  type ReportFormat,
  type ReportJobDto,
  type ReportJobStatus,
  type ReportKind,
  type ReportQuery,
  type ReportResult,
} from '@ordens/contracts';
import type { Tx } from '@ordens/db';
import { renderReport, ReportError, reportPeriod, runReport } from '@ordens/reports';
import type { Response } from 'express';
import { RequirePermission } from '../../common/decorators.js';
import { AppError } from '../../common/errors.js';
import { currentAuth } from '../../common/request-context.js';
import { ZodPipe } from '../../common/zod.pipe.js';
import { StorageService } from '../../infra/storage.service.js';
import { TenantDb } from '../../infra/tenant-db.service.js';

const uuid = new ParseUUIDPipe({ errorHttpStatusCode: 404 });

/** Regra do relatório (perfil ou período) → erro amigável da API. */
function asAppError(err: unknown): never {
  if (err instanceof ReportError) {
    if (err.reason === 'forbidden') throw AppError.forbidden(err.message);
    throw AppError.validation({ fields: { [err.field ?? 'from']: [err.message] } });
  }
  throw err;
}

type JobRow = NonNullable<Awaited<ReturnType<Tx['reportJob']['findUnique']>>>;

function jobDto(j: JobRow): ReportJobDto {
  const params = (j.params ?? {}) as { from?: string; to?: string };
  const kind = j.kind as ReportKind;
  return {
    id: j.id,
    kind,
    label: REPORT_INFO[kind]?.label ?? kind,
    format: j.format as ReportFormat,
    from: params.from ?? null,
    to: params.to ?? null,
    status: j.status as ReportJobStatus,
    rows: j.rows,
    total: j.total,
    truncated: j.truncated,
    sizeBytes: j.sizeBytes === null ? null : Number(j.sizeBytes),
    error: j.error,
    createdAt: j.createdAt.toISOString(),
    finishedAt: j.finishedAt?.toISOString() ?? null,
    expiresAt: j.expiresAt?.toISOString() ?? null,
  };
}

@Injectable()
export class ReportsService {
  constructor(
    private readonly db: TenantDb,
    private readonly storage: StorageService,
  ) {}

  private run(tx: Tx, kind: ReportKind, q: ReportQuery, limit: number): Promise<ReportResult> {
    return runReport(tx, kind, q, limit, currentAuth().membership?.scope ?? '').catch(asAppError);
  }

  preview(kind: ReportKind, q: ReportQuery): Promise<ReportResult> {
    return this.db.read((tx) => this.run(tx, kind, q, REPORT_PREVIEW_LIMIT));
  }

  /** Exportação imediata (até o limite do formato), auditada na mesma transação da leitura. */
  export(kind: ReportKind, q: ReportQuery, format: ReportFormat): Promise<{ body: string | Buffer; filename: string; contentType: string; result: ReportResult }> {
    return this.db.write(async (scope) => {
      const result = await this.run(scope.tx, kind, q, format === 'pdf' ? REPORT_PDF_LIMIT : REPORT_EXPORT_LIMIT);
      await scope.audit({
        entityType: 'report',
        entityId: null,
        action: 'report.exported',
        after: { kind, format, label: result.label, from: result.from, to: result.to, commodityId: q.commodityId ?? null, rows: result.rows.length, total: result.total },
      });
      return { ...(await renderReport(result, format)), result };
    });
  }

  /**
   * Exportação em segundo plano: registra o pedido e publica o evento na mesma transação; o worker
   * gera o arquivo com o contexto de RLS de quem pediu.
   */
  requestJob(kind: ReportKind, input: CreateReportJobInput): Promise<ReportJobDto> {
    const auth = currentAuth();
    const m = auth.membership!;
    if (!(REPORT_INFO[kind].scopes as readonly string[]).includes(m.scope)) {
      throw AppError.forbidden('Este relatório não está disponível para o seu perfil.');
    }
    let period: { from: string; to: string };
    try {
      period = reportPeriod(input);
    } catch (err) {
      asAppError(err);
    }
    return this.db.write(async (scope) => {
      const job = await scope.tx.reportJob.create({
        data: {
          tenantId: m.tenantId,
          membershipId: m.id,
          requestedBy: auth.userId,
          kind,
          format: input.format,
          params: { ...period, ...(input.commodityId ? { commodityId: input.commodityId } : {}) },
        },
      });
      await scope.audit({ entityType: 'report_job', entityId: job.id, action: 'report.requested', after: { kind, format: input.format, ...period } });
      await scope.outbox({ type: 'report.requested', aggregateType: 'report_job', aggregateId: job.id, payload: { jobId: job.id } });
      return jobDto(job);
    });
  }

  /** Exportações recentes de quem consulta (o RLS limita às próprias). */
  listJobs(): Promise<ReportJobDto[]> {
    return this.db.read(async (tx) => (await tx.reportJob.findMany({ orderBy: { createdAt: 'desc' }, take: 20 })).map(jobDto));
  }

  /** Link temporário do arquivo pronto; o download é auditado. */
  async downloadJob(id: string): Promise<{ url: string; expiresInSeconds: number }> {
    const job = await this.db.read((tx) => tx.reportJob.findUnique({ where: { id } }));
    if (!job) throw AppError.notFound('Exportação não encontrada.');
    if (job.status !== 'DONE' || !job.bucket || !job.objectKey) throw AppError.conflict('O arquivo desta exportação não está disponível.');
    if (job.expiresAt && job.expiresAt < new Date()) throw AppError.conflict('O arquivo desta exportação expirou. Gere o relatório de novo.');
    const params = (job.params ?? {}) as { from?: string; to?: string };
    await this.db.write((scope) => scope.audit({ entityType: 'report_job', entityId: id, action: 'report.downloaded', after: { kind: job.kind, format: job.format } }));
    const filename = `relatorio-${job.kind}-${params.from ?? ''}-a-${params.to ?? ''}.${job.format}`;
    return { url: await this.storage.presignGet(job.bucket, job.objectKey, filename, 60), expiresInSeconds: 60 };
  }
}

@ApiTags('relatórios')
@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  // Rotas de exportação em segundo plano antes de ":kind" (senão "jobs" seria lido como relatório).
  @Get('jobs')
  @RequirePermission('report.export')
  jobs() {
    return this.reports.listJobs();
  }

  @Get('jobs/:id/download')
  @RequirePermission('report.export')
  download(@Param('id', uuid) id: string) {
    return this.reports.downloadJob(id);
  }

  @Post(':kind/jobs')
  @RequirePermission('report.export')
  requestJob(@Param('kind', new ZodPipe(reportKindSchema)) kind: ReportKind, @Body(new ZodPipe(createReportJobSchema)) body: CreateReportJobInput) {
    return this.reports.requestJob(kind, body);
  }

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
