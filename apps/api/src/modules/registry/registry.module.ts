import { Module } from '@nestjs/common';
import { CatalogService } from './catalog.service.js';
import { FarmsService } from './farms.service.js';
import { PartnersService } from './partners.service.js';
import { CommoditiesController, DriversController, FarmsController, PartnersController, VehiclesController } from './registry.controllers.js';

@Module({
  controllers: [PartnersController, FarmsController, CommoditiesController, DriversController, VehiclesController],
  providers: [PartnersService, FarmsService, CatalogService],
})
export class RegistryModule {}
