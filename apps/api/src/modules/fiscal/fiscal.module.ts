import { Body, Controller, Get, HttpCode, Module, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  cursorQuery,
  type CursorPage,
  type LookupOption,
  documentListQuery,
  documentVisibilitySchema,
  invoiceCancelSchema,
  invoiceListQuery,
  occurrenceInputSchema,
  occurrenceListQuery,
  occurrenceTransitionSchema,
  occurrenceUpdateSchema,
  type DocumentListQuery,
  type InvoiceListQuery,
  type OccurrenceListQuery,
} from '@ordens/contracts';
import type { z } from 'zod';
import { RequirePermission } from '../../common/decorators.js';
import { ZodPipe } from '../../common/zod.pipe.js';
import { TenantDb } from '../../infra/tenant-db.service.js';
import { DocumentsService } from './documents.service.js';
import { InvoicesService } from './invoices.service.js';
import { OccurrencesService } from './occurrences.service.js';

const uuid = new ParseUUIDPipe({ errorHttpStatusCode: 404 });

@ApiTags('fiscal')
@Controller('invoices')
export class InvoicesController {
  constructor(private readonly invoices: InvoicesService) {}

  @Get()
  @RequirePermission('document.read')
  list(@Query(new ZodPipe(invoiceListQuery)) q: InvoiceListQuery) {
    return this.invoices.list(q);
  }

  @Get(':id')
  @RequirePermission('document.read')
  detail(@Param('id', uuid) id: string) {
    return this.invoices.detail(id);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @RequirePermission('invoice.upload')
  cancel(@Param('id', uuid) id: string, @Body(new ZodPipe(invoiceCancelSchema)) body: z.output<typeof invoiceCancelSchema>) {
    return this.invoices.cancel(id, body.reason);
  }
}

@ApiTags('ocorrências')
@Controller('occurrences')
export class OccurrencesController {
  constructor(private readonly occurrences: OccurrencesService) {}

  @Get()
  @RequirePermission('occurrence.read')
  list(@Query(new ZodPipe(occurrenceListQuery)) q: OccurrenceListQuery) {
    return this.occurrences.list(q);
  }

  @Get(':id')
  @RequirePermission('occurrence.read')
  detail(@Param('id', uuid) id: string) {
    return this.occurrences.detail(id);
  }

  @Post()
  @RequirePermission('occurrence.manage')
  create(@Body(new ZodPipe(occurrenceInputSchema)) body: z.output<typeof occurrenceInputSchema>) {
    return this.occurrences.create(body);
  }

  @Put(':id')
  @RequirePermission('occurrence.manage')
  update(@Param('id', uuid) id: string, @Body(new ZodPipe(occurrenceUpdateSchema)) body: z.output<typeof occurrenceUpdateSchema>) {
    return this.occurrences.update(id, body);
  }

  @Post(':id/transition')
  @HttpCode(200)
  @RequirePermission('occurrence.manage')
  transition(@Param('id', uuid) id: string, @Body(new ZodPipe(occurrenceTransitionSchema)) body: z.output<typeof occurrenceTransitionSchema>) {
    return this.occurrences.transition(id, body);
  }
}

@ApiTags('documentos')
@Controller('documents')
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Get()
  @RequirePermission('document.read')
  list(@Query(new ZodPipe(documentListQuery)) q: DocumentListQuery) {
    return this.documents.list(q);
  }

  @Patch(':id/visibility')
  @RequirePermission('document.upload')
  visibility(@Param('id', uuid) id: string, @Body(new ZodPipe(documentVisibilitySchema)) body: z.output<typeof documentVisibilitySchema>) {
    return this.documents.setVisibility(id, body.visibility);
  }
}

@ApiTags('ocorrências')
@Controller('lookups')
export class FiscalLookupsController {
  constructor(private readonly db: TenantDb) {}

  /** Usuários ativos da Matriz que podem ser responsáveis por ocorrências. */
  @Get('responsibles')
  @RequirePermission('occurrence.manage')
  responsibles(@Query(new ZodPipe(cursorQuery)) q: z.output<typeof cursorQuery>): Promise<CursorPage<LookupOption>> {
    return this.db.read(async (tx) => {
      const memberships = await tx.membership.findMany({ where: { scope: 'MATRIZ', status: 'ACTIVE' }, select: { userId: true } });
      const users = await tx.user.findMany({
        where: {
          id: { in: [...new Set(memberships.map((m) => m.userId))] },
          ...(q.q ? { OR: [{ name: { contains: q.q, mode: 'insensitive' } }, { email: { contains: q.q, mode: 'insensitive' } }] } : {}),
        },
        orderBy: { name: 'asc' },
        take: 50,
        select: { id: true, name: true, email: true },
      });
      return { nextCursor: null, items: users.map((u) => ({ id: u.id, label: u.name, description: u.email })) };
    });
  }
}

@Module({
  controllers: [InvoicesController, OccurrencesController, DocumentsController, FiscalLookupsController],
  providers: [InvoicesService, OccurrencesService, DocumentsService],
})
export class FiscalModule {}
