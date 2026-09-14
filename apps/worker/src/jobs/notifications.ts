import { systemContext } from '@ordens/db';
import type { Job } from 'bullmq';
import type { WorkerContext } from '../context.js';
import type { OutboxJob } from '../queues.js';

/** Cria notificações in-app para usuários das organizações envolvidas. Idempotente por evento + usuário. */
export function notificationsHandler(ctx: WorkerContext) {
  return async (job: Job<OutboxJob>) => {
    const { tenantId, payload, type, eventId } = job.data;
    if (!tenantId) return;
    const orderId = String(payload.orderId);
    const sysCtx = systemContext(tenantId);

    await ctx.db.run(sysCtx, async (tx) => {
      const order = await tx.loadingOrder.findUnique({
        where: { id: orderId },
        select: { number: true, version: true, sellerOrgId: true, buyerOrgId: true },
      });
      if (!order) return;

      const orgIds =
        type === 'order.release_created'
          ? [order.sellerOrgId]
          : [order.sellerOrgId, order.buyerOrgId];
      const targets = orgIds.filter((v): v is string => Boolean(v));
      if (!targets.length) return;

      const memberships = await tx.membership.findMany({
        where: { organizationId: { in: targets }, status: 'ACTIVE' },
        select: { userId: true, scope: true },
      });

      const title =
        type === 'order.published'
          ? `Nova ordem ${order.number}`
          : type === 'order.version_created'
            ? `Ordem ${order.number} atualizada (v${order.version})`
            : `Nova liberação na ordem ${order.number}`;
      const body =
        type === 'order.release_created'
          ? `Liberação ${String(payload.sequence)} de ${String(payload.quantity)} registrada.`
          : type === 'order.published'
            ? 'Uma nova ordem de carregamento foi publicada para sua organização.'
            : 'A Matriz alterou informações relevantes. Revise a nova versão.';

      const existing = await tx.notification.findMany({
        where: { userId: { in: memberships.map((m) => m.userId) }, data: { path: ['eventId'], equals: eventId } },
        select: { userId: true },
      });
      const already = new Set(existing.map((e) => e.userId));

      await tx.notification.createMany({
        data: memberships
          .filter((m) => !already.has(m.userId))
          .map((m) => ({ tenantId, userId: m.userId, type, title, body, data: { eventId, orderId, version: order.version } })),
      });
    });
  };
}
