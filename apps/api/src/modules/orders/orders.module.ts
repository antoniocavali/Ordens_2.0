import { Module } from '@nestjs/common';
import { LookupsController } from './lookups.controller.js';
import { LookupsService } from './lookups.service.js';
import { OrdersController } from './orders.controller.js';
import { OrdersService } from './orders.service.js';

@Module({
  controllers: [OrdersController, LookupsController],
  providers: [OrdersService, LookupsService],
})
export class OrdersModule {}
