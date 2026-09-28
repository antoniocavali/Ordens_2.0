import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  commodityInputSchema,
  farmInputSchema,
  partnerInputSchema,
  registryListQuery,
  type RegistryListQuery,
} from '@ordens/contracts';
import type { z } from 'zod';
import { RequirePermission } from '../../common/decorators.js';
import { ZodPipe } from '../../common/zod.pipe.js';
import { CatalogService } from './catalog.service.js';
import { FarmsService } from './farms.service.js';
import { PartnersService } from './partners.service.js';

const uuid = new ParseUUIDPipe({ errorHttpStatusCode: 404 });
const listPipe = new ZodPipe(registryListQuery);

@ApiTags('cadastros')
@Controller('partners')
export class PartnersController {
  constructor(private readonly partners: PartnersService) {}

  @Get()
  @RequirePermission('partner.read')
  list(@Query(listPipe) q: RegistryListQuery) {
    return this.partners.list(q);
  }

  @Get(':id')
  @RequirePermission('partner.read')
  detail(@Param('id', uuid) id: string) {
    return this.partners.detail(id);
  }

  @Post()
  @RequirePermission('partner.manage')
  create(@Body(new ZodPipe(partnerInputSchema)) body: z.output<typeof partnerInputSchema>) {
    return this.partners.create(body);
  }

  @Put(':id')
  @RequirePermission('partner.manage')
  update(@Param('id', uuid) id: string, @Body(new ZodPipe(partnerInputSchema)) body: z.output<typeof partnerInputSchema>) {
    return this.partners.update(id, body);
  }

  @Post(':id/archive')
  @HttpCode(200)
  @RequirePermission('partner.manage')
  archive(@Param('id', uuid) id: string) {
    return this.partners.setArchived(id, true);
  }

  @Post(':id/restore')
  @HttpCode(200)
  @RequirePermission('partner.manage')
  restore(@Param('id', uuid) id: string) {
    return this.partners.setArchived(id, false);
  }
}

@ApiTags('cadastros')
@Controller('farms')
export class FarmsController {
  constructor(private readonly farms: FarmsService) {}

  @Get()
  @RequirePermission('farm.read')
  list(@Query(listPipe) q: RegistryListQuery) {
    return this.farms.list(q);
  }

  @Get(':id')
  @RequirePermission('farm.read')
  detail(@Param('id', uuid) id: string) {
    return this.farms.detail(id);
  }

  @Post()
  @RequirePermission('farm.manage')
  create(@Body(new ZodPipe(farmInputSchema)) body: z.output<typeof farmInputSchema>) {
    return this.farms.create(body);
  }

  @Put(':id')
  @RequirePermission('farm.manage')
  update(@Param('id', uuid) id: string, @Body(new ZodPipe(farmInputSchema)) body: z.output<typeof farmInputSchema>) {
    return this.farms.update(id, body);
  }

  @Post(':id/archive')
  @HttpCode(200)
  @RequirePermission('farm.manage')
  archive(@Param('id', uuid) id: string) {
    return this.farms.setArchived(id, true);
  }

  @Post(':id/restore')
  @HttpCode(200)
  @RequirePermission('farm.manage')
  restore(@Param('id', uuid) id: string) {
    return this.farms.setArchived(id, false);
  }
}

@ApiTags('cadastros')
@Controller('commodities')
export class CommoditiesController {
  constructor(private readonly catalog: CatalogService) {}

  @Get()
  @RequirePermission('commodity.read')
  list(@Query(listPipe) q: RegistryListQuery) {
    return this.catalog.listCommodities(q);
  }

  @Post()
  @RequirePermission('commodity.manage')
  create(@Body(new ZodPipe(commodityInputSchema)) body: z.output<typeof commodityInputSchema>) {
    return this.catalog.saveCommodity(null, body);
  }

  @Put(':id')
  @RequirePermission('commodity.manage')
  update(@Param('id', uuid) id: string, @Body(new ZodPipe(commodityInputSchema)) body: z.output<typeof commodityInputSchema>) {
    return this.catalog.saveCommodity(id, body);
  }
}
