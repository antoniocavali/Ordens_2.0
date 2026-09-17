import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  assignFarmSchema,
  buyerOrderSchema,
  orderReasonActionSchema,
  resumeOrderSchema,
  type OrderReasonActionInput,
  submitOrderSchema,
  updateBuyerOrderSchema,
  type AssignFarmInput,
  type BuyerOrderInput,
  type UpdateBuyerOrderInput,
  cancelReleaseSchema,
  completeOrderSchema,
  type CompleteOrderInput,
  createReleaseSchema,
  orderDraftSchema,
  orderListQuerySchema,
  publishOrderSchema,
  releaseListQuerySchema,
  requestPublishSchema,
  updateOrderSchema,
  type CancelReleaseInput,
  type CreateReleaseInput,
  type ReleaseListQuery,
  type OrderDraftInput,
  type OrderListQuery,
  type UpdateOrderInput,
} from '@ordens/contracts';
import type { z } from 'zod';
import { RequireAnyPermission, RequirePermission } from '../../common/decorators.js';
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

  /** Portal do Comprador: payload próprio (estrito); comprador derivado da organização ativa. */
  @Post('buyer')
  @RequirePermission('order.submit')
  createBuyer(@Body(new ZodPipe(buyerOrderSchema)) body: BuyerOrderInput) {
    return this.orders.createBuyerOrder(body);
  }

  @Patch('buyer/:id')
  @RequirePermission('order.submit')
  updateBuyer(@Param('id', uuid) id: string, @Body(new ZodPipe(updateBuyerOrderSchema)) body: UpdateBuyerOrderInput) {
    return this.orders.updateBuyerOrder(id, body);
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

  @Post(':id/submit')
  @HttpCode(200)
  @RequirePermission('order.submit')
  submit(@Param('id', uuid) id: string, @Body(new ZodPipe(submitOrderSchema)) body: z.infer<typeof submitOrderSchema>) {
    return this.orders.submitOrder(id, body.expectedUpdatedAt);
  }

  @Post(':id/billing/assign')
  @HttpCode(200)
  @RequirePermission('order.billing.manage')
  assignFarm(@Param('id', uuid) id: string, @Body(new ZodPipe(assignFarmSchema)) body: AssignFarmInput) {
    return this.orders.assignFarm(id, body);
  }

  @Post(':id/billing/publish')
  @HttpCode(200)
  @RequirePermission('order.billing.manage')
  billingPublish(@Param('id', uuid) id: string, @Body(new ZodPipe(submitOrderSchema)) body: z.infer<typeof submitOrderSchema>) {
    return this.orders.billingPublish(id, body.expectedUpdatedAt);
  }

  @Post(':id/suspend')
  @HttpCode(200)
  @RequirePermission('order.cancel')
  suspend(@Param('id', uuid) id: string, @Body(new ZodPipe(orderReasonActionSchema)) body: OrderReasonActionInput) {
    return this.orders.suspendOrder(id, body);
  }

  @Post(':id/resume')
  @HttpCode(200)
  @RequirePermission('order.cancel')
  resume(@Param('id', uuid) id: string, @Body(new ZodPipe(resumeOrderSchema)) body: z.infer<typeof resumeOrderSchema>) {
    return this.orders.resumeOrder(id, body.expectedUpdatedAt);
  }

  @Get(':id/completion-check')
  @RequirePermission('order.cancel')
  completionCheck(@Param('id', uuid) id: string) {
    return this.orders.completionCheck(id);
  }

  /** Q45: conclusão informada pela Matriz (aceite explícito quando faltam PDF/XML da Fazenda). */
  @Post(':id/complete')
  @RequirePermission('order.cancel')
  complete(@Param('id', uuid) id: string, @Body(new ZodPipe(completeOrderSchema)) body: CompleteOrderInput) {
    return this.orders.completeOrder(id, body);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @RequirePermission('order.cancel')
  cancel(@Param('id', uuid) id: string, @Body(new ZodPipe(orderReasonActionSchema)) body: OrderReasonActionInput) {
    return this.orders.cancelOrder(id, body);
  }

  @Post(':id/billing/return')
  @HttpCode(200)
  @RequirePermission('order.billing.manage')
  returnToBuyer(@Param('id', uuid) id: string, @Body(new ZodPipe(orderReasonActionSchema)) body: OrderReasonActionInput) {
    return this.orders.returnToBuyer(id, body);
  }

  @Post(':id/buyer-cancel')
  @HttpCode(200)
  @RequirePermission('order.submit')
  cancelByBuyer(@Param('id', uuid) id: string, @Body(new ZodPipe(orderReasonActionSchema)) body: OrderReasonActionInput) {
    return this.orders.cancelBuyerOrder(id, body);
  }

  @Post(':id/publish-request')
  @HttpCode(200)
  @RequireAnyPermission('order.create', 'order.update')
  requestPublish(@Param('id', uuid) id: string, @Body(new ZodPipe(requestPublishSchema)) body: z.infer<typeof requestPublishSchema>) {
    return this.orders.requestPublish(id, body.expectedUpdatedAt);
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
