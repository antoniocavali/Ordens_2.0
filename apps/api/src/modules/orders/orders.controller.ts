import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  createReleaseSchema,
  orderDraftSchema,
  orderListQuerySchema,
  publishOrderSchema,
  updateOrderSchema,
  type CreateReleaseInput,
  type OrderDraftInput,
  type OrderListQuery,
  type UpdateOrderInput,
} from '@ordens/contracts';
import type { z } from 'zod';
import { RequirePermission } from '../../common/decorators.js';
import { ZodPipe } from '../../common/zod.pipe.js';
import { OrdersService } from './orders.service.js';

const uuid = new ParseUUIDPipe({ version: '4', errorHttpStatusCode: 404 });

@ApiTags('orders')
@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get()
  @RequirePermission('order.read')
  list(@Query(new ZodPipe(orderListQuerySchema)) query: OrderListQuery) {
    return this.orders.list(query);
  }

  @Get('summary')
  @RequirePermission('order.read')
  summary() {
    return this.orders.summary();
  }

  @Get(':id')
  @RequirePermission('order.read')
  detail(@Param('id', uuid) id: string) {
    return this.orders.detail(id);
  }

  @Post()
  @RequirePermission('order.create')
  create(@Body(new ZodPipe(orderDraftSchema)) body: OrderDraftInput) {
    return this.orders.create(body);
  }

  @Patch(':id')
  @RequirePermission('order.update')
  update(@Param('id', uuid) id: string, @Body(new ZodPipe(updateOrderSchema)) body: UpdateOrderInput) {
    return this.orders.update(id, body);
  }

  @Post(':id/publish')
  @HttpCode(200)
  @RequirePermission('order.publish')
  publish(@Param('id', uuid) id: string, @Body(new ZodPipe(publishOrderSchema)) body: z.infer<typeof publishOrderSchema>) {
    return this.orders.publish(id, body.expectedUpdatedAt);
  }

  @Post(':id/releases')
  @RequirePermission('order.release')
  release(@Param('id', uuid) id: string, @Body(new ZodPipe(createReleaseSchema)) body: CreateReleaseInput) {
    return this.orders.createRelease(id, body);
  }

  /** Chamado pela UI somente ao abrir efetivamente o detalhe (não na renderização da tabela). */
  @Post(':id/views')
  @HttpCode(200)
  @RequirePermission('order.read')
  view(@Param('id', uuid) id: string) {
    return this.orders.registerView(id);
  }

  @Get(':id/timeline')
  @RequirePermission('order.read')
  timeline(@Param('id', uuid) id: string) {
    return this.orders.timeline(id);
  }

  @Get(':id/versions')
  @RequirePermission('order.read')
  versions(@Param('id', uuid) id: string) {
    return this.orders.versions(id);
  }

  @Get(':id/view-history')
  @RequirePermission('order.read')
  viewHistory(@Param('id', uuid) id: string) {
    return this.orders.viewHistory(id);
  }
}
