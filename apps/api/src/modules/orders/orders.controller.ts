import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  cancelReleaseSchema,
  createReleaseSchema,
  orderDraftSchema,
  orderListQuerySchema,
  publishOrderSchema,
  releaseListQuerySchema,
  updateOrderSchema,
  type CancelReleaseInput,
  type CreateReleaseInput,
  type ReleaseListQuery,
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

  /** Liberações de todas as ordens visíveis (declarado antes de ':id'). */
  @Get('releases')
  @RequirePermission('order.read')
  releases(@Query(new ZodPipe(releaseListQuerySchema)) query: ReleaseListQuery) {
    return this.orders.listReleases(query);
  }

  @Get('releases/summary')
  @RequirePermission('order.read')
  releasesSummary() {
    return this.orders.releasesSummary();
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

  @Post(':id/releases/:releaseId/cancel')
  @HttpCode(200)
  @RequirePermission('order.release')
  cancelRelease(
    @Param('id', uuid) id: string,
    @Param('releaseId', uuid) releaseId: string,
    @Body(new ZodPipe(cancelReleaseSchema)) body: CancelReleaseInput,
  ) {
    return this.orders.cancelRelease(id, releaseId, body);
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
