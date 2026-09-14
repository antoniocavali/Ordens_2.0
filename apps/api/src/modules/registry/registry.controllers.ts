import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  commodityInputSchema,
  driverInputSchema,
  farmInputSchema,
  locationInputSchema,
  partnerInputSchema,
  registryListQuery,
  vehicleInputSchema,
  type RegistryListQuery,
} from '@ordens/contracts';
import type { z } from 'zod';
import { RequirePermission } from '../../common/decorators.js';
import { ZodPipe } from '../../common/zod.pipe.js';
import { CatalogService } from './catalog.service.js';
import { FarmsService } from './farms.service.js';
import { LocationsService } from './locations.service.js';
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
@Controller('locations')
export class LocationsController {
  constructor(private readonly locations: LocationsService) {}

  @Get()
  @RequirePermission('partner.read')
  list(@Query(listPipe) q: RegistryListQuery) {
    return this.locations.list(q);
  }

  @Get(':id')
  @RequirePermission('partner.read')
  detail(@Param('id', uuid) id: string) {
    return this.locations.detail(id);
  }

  @Post()
  @RequirePermission('partner.manage')
  create(@Body(new ZodPipe(locationInputSchema)) body: z.output<typeof locationInputSchema>) {
    return this.locations.create(body);
  }

  @Put(':id')
  @RequirePermission('partner.manage')
  update(@Param('id', uuid) id: string, @Body(new ZodPipe(locationInputSchema)) body: z.output<typeof locationInputSchema>) {
    return this.locations.update(id, body);
  }

  @Post(':id/archive')
  @HttpCode(200)
  @RequirePermission('partner.manage')
  archive(@Param('id', uuid) id: string) {
    return this.locations.setArchived(id, true);
  }

  @Post(':id/restore')
  @HttpCode(200)
  @RequirePermission('partner.manage')
  restore(@Param('id', uuid) id: string) {
    return this.locations.setArchived(id, false);
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

@ApiTags('cadastros')
@Controller('drivers')
export class DriversController {
  constructor(private readonly catalog: CatalogService) {}

  @Get()
  @RequirePermission('carrier.read')
  list(@Query(listPipe) q: RegistryListQuery) {
    return this.catalog.listDrivers(q);
  }

  @Get(':id')
  @RequirePermission('carrier.read')
  detail(@Param('id', uuid) id: string) {
    return this.catalog.driverDetail(id);
  }

  @Post()
  @RequirePermission('carrier.manage')
  create(@Body(new ZodPipe(driverInputSchema)) body: z.output<typeof driverInputSchema>) {
    return this.catalog.saveDriver(null, body);
  }

  @Put(':id')
  @RequirePermission('carrier.manage')
  update(@Param('id', uuid) id: string, @Body(new ZodPipe(driverInputSchema)) body: z.output<typeof driverInputSchema>) {
    return this.catalog.saveDriver(id, body);
  }

  @Post(':id/archive')
  @HttpCode(204)
  @RequirePermission('carrier.manage')
  archive(@Param('id', uuid) id: string) {
    return this.catalog.setArchived('driver', id, true);
  }
}

@ApiTags('cadastros')
@Controller('vehicles')
export class VehiclesController {
  constructor(private readonly catalog: CatalogService) {}

  @Get()
  @RequirePermission('carrier.read')
  list(@Query(listPipe) q: RegistryListQuery) {
    return this.catalog.listVehicles(q);
  }

  @Post()
  @RequirePermission('carrier.manage')
  create(@Body(new ZodPipe(vehicleInputSchema)) body: z.output<typeof vehicleInputSchema>) {
    return this.catalog.saveVehicle(null, body);
  }

  @Put(':id')
  @RequirePermission('carrier.manage')
  update(@Param('id', uuid) id: string, @Body(new ZodPipe(vehicleInputSchema)) body: z.output<typeof vehicleInputSchema>) {
    return this.catalog.saveVehicle(id, body);
  }

  @Post(':id/archive')
  @HttpCode(204)
  @RequirePermission('carrier.manage')
  archive(@Param('id', uuid) id: string) {
    return this.catalog.setArchived('vehicle', id, true);
  }
}
