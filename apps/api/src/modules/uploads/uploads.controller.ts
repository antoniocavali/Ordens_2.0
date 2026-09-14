import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { completeUploadSchema, initiateUploadSchema, partUrlsSchema, UPLOAD_ENTITY_TYPES, type InitiateUploadInput } from '@ordens/contracts';
import { z } from 'zod';
import { RequirePermission } from '../../common/decorators.js';
import { ZodPipe } from '../../common/zod.pipe.js';
import { UploadsService } from './uploads.service.js';

const uuid = new ParseUUIDPipe({ errorHttpStatusCode: 404 });
const listQuery = z.object({ entityType: z.enum(UPLOAD_ENTITY_TYPES), entityId: z.uuid() });

@ApiTags('uploads')
@Controller('uploads')
export class UploadsController {
  constructor(private readonly uploads: UploadsService) {}

  @Post()
  @RequirePermission('document.upload')
  initiate(@Body(new ZodPipe(initiateUploadSchema)) body: InitiateUploadInput) {
    return this.uploads.initiate(body);
  }

  @Get()
  @RequirePermission('document.read')
  list(@Query(new ZodPipe(listQuery)) q: z.infer<typeof listQuery>) {
    return this.uploads.list(q.entityType, q.entityId);
  }

  @Get(':id')
  @RequirePermission('document.read')
  status(@Param('id', uuid) id: string) {
    return this.uploads.status(id);
  }

  @Post(':id/parts')
  @HttpCode(200)
  @RequirePermission('document.upload')
  parts(@Param('id', uuid) id: string, @Body(new ZodPipe(partUrlsSchema)) body: z.infer<typeof partUrlsSchema>) {
    return this.uploads.partUrls(id, body.partNumbers);
  }

  @Post(':id/complete')
  @HttpCode(200)
  @RequirePermission('document.upload')
  complete(@Param('id', uuid) id: string, @Body(new ZodPipe(completeUploadSchema)) body: z.infer<typeof completeUploadSchema>) {
    return this.uploads.complete(id, body.parts);
  }

  @Post(':id/abort')
  @HttpCode(204)
  @RequirePermission('document.upload')
  abort(@Param('id', uuid) id: string) {
    return this.uploads.abort(id);
  }

  @Get(':id/download')
  @RequirePermission('document.read')
  download(@Param('id', uuid) id: string) {
    return this.uploads.downloadUrl(id);
  }
}
