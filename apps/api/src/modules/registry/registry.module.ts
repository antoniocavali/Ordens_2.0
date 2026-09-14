import { Module } from '@nestjs/common';
import { CatalogService } from './catalog.service.js';
import { FarmsService } from './farms.service.js';
import { LocationsService } from './locations.service.js';
import { PartnersService } from './partners.service.js';
import { CommoditiesController, DriversController, FarmsController, LocationsController, PartnersController, VehiclesController } from './registry.controllers.js';

@Module({
  controllers: [PartnersController, FarmsController, LocationsController, CommoditiesController, DriversController, VehiclesController],
  providers: [PartnersService, FarmsService, LocationsService, CatalogService],
})
export class RegistryModule {}
