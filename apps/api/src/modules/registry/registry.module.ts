import { Module } from '@nestjs/common';
import { CatalogService } from './catalog.service.js';
import { FarmsService } from './farms.service.js';
import { PartnersService } from './partners.service.js';
import { CommoditiesController, FarmsController, PartnersController } from './registry.controllers.js';

@Module({
  controllers: [PartnersController, FarmsController, CommoditiesController],
  providers: [PartnersService, FarmsService, CatalogService],
})
export class RegistryModule {}
