import { INVOICE_REJECT_LABELS, REALTIME_CHANNEL, type InvoiceRejectCode, type RealtimeMessage } from '@ordens/contracts';
import { systemContext, type Tx } from '@ordens/db';
import type { Job } from 'bullmq';
import type { Redis } from 'ioredis';
import type { WorkerContext } from '../context.js';
import type { OutboxJob } from '../queues.js';

interface Plan {
  userIds: string[];
  title: string;
  body: string | null;
  data: Record<string, string | number | null>;
}

const str = (v: unknown) => (typeof v === 'string' ? v : null);

async function usersOf(tx: Tx, orgIds: (string | null | undefined)[]) {
  const ids = orgIds.filter((v): v is string => Boolean(v));
  if (!ids.length) return [];
  const members = await tx.membership.findMany({ where: { organizationId: { in: ids }, status: 'ACTIVE' }, select: { userId: true } });
  return [...new Set(members.map((m) => m.userId))];
}

/** Destinatários e texto de cada aviso (Q25). Retorna null quando o evento não gera notificação. */
export async function notificationPlan(tx: Tx, type: string, p: Record<string, unknown>): Promise<Plan | null> {
  switch (type) {
    case 'order.published':
    case 'order.version_created':
    case 'order.release_created': {
      const orderId = str(p.orderId);
      const order = orderId
        ? await tx.loadingOrder.findUnique({ where: { id: orderId }, select: { number: true, version: true, sellerOrgId: true, buyerOrgId: true } })
        : null;
      if (!order) return null;
      const release = type === 'order.release_created';
      return {
        userIds: await usersOf(tx, release ? [order.sellerOrgId] : [order.sellerOrgId, order.buyerOrgId]),
        title: type === 'order.published' ? `Nova ordem ${order.number}` : release ? `Nova liberação na ordem ${order.number}` : `Ordem ${order.number} atualizada (v${order.version})`,
        body: release
          ? `Liberação ${String(p.sequence)} de ${String(p.quantity)} registrada.`
          : type === 'order.published'
            ? 'Uma nova ordem de carregamento foi publicada para sua organização.'
            : 'A Matriz alterou informações relevantes. Revise a nova versão.',
        data: { orderId, version: order.version },
      };
    }

    case 'invoice.processed': {
      const status = str(p.status);
      const invoiceId = str(p.invoiceId);
      const uploader = str(p.createdBy);
      if (!invoiceId || !uploader || (status !== 'REJECTED' && status !== 'DIVERGENT')) return null;
      const inv = await tx.invoice.findUnique({ where: { id: invoiceId }, select: { number: true, rejectReason: true, loadId: true, orderId: true } });
      if (!inv) return null;
      const load = await tx.load.findUnique({ where: { id: inv.loadId }, select: { number: true } });
      const rejected = status === 'REJECTED';
      return {
        userIds: [uploader],
        title: rejected ? `XML rejeitado na carga ${load?.number ?? ''}`.trim() : `NF-e ${inv.number ?? ''} com divergência`.replace('  ', ' '),
        body: rejected
          ? (INVOICE_REJECT_LABELS[inv.rejectReason as InvoiceRejectCode] ?? 'Verifique o arquivo e envie novamente.')
          : 'Confira emitente, placa e peso na nota.',
        data: { invoiceId, loadId: inv.loadId, orderId: inv.orderId },
      };
    }

    case 'occurrence.opened': {
      const occurrenceId = str(p.occurrenceId);
      const oc = occurrenceId
        ? await tx.occurrence.findUnique({
            where: { id: occurrenceId },
            select: { number: true, title: true, responsibleUserId: true, visibility: true, sellerOrgId: true, source: true, orderId: true, loadId: true },
          })
        : null;
      if (!oc) return null;
      const recipients = new Set<string>(oc.responsibleUserId ? [oc.responsibleUserId] : []);
      // Ocorrência automática (divergência de peso) avisa a Fazenda quando é visível para ela.
      if (oc.source === 'SYSTEM' && (oc.visibility === 'FARM' || oc.visibility === 'PARTIES')) {
        for (const u of await usersOf(tx, [oc.sellerOrgId])) recipients.add(u);
      }
      if (!recipients.size) return null;
      return { userIds: [...recipients], title: `Ocorrência ${oc.number}`, body: oc.title, data: { occurrenceId, orderId: oc.orderId, loadId: oc.loadId } };
    }

    case 'load.status_changed': {
      if (p.to !== 'IN_TRANSIT') return null;
      const orderId = str(p.orderId);
      const order = orderId ? await tx.loadingOrder.findUnique({ where: { id: orderId }, select: { buyerOrgId: true } }) : null;
      if (!order) return null;
      return {
        userIds: await usersOf(tx, [order.buyerOrgId]),
        title: `Carga ${String(p.number)} a caminho`,
        body: 'A carga saiu da fazenda com destino à sua unidade.',
        data: { loadId: str(p.loadId), orderId },
      };
    }

    case 'support.message_created': {
      const conversationId = str(p.conversationId);
      if (!conversationId || p.internal === true) return null;
      const number = String(p.number ?? '');
      if (p.fromAgent === true) {
        const requester = str(p.requesterUserId);
        return requester
          ? { userIds: [requester], title: `Nova resposta no atendimento ${number}`, body: str(p.preview), data: { conversationId, href: `/?atendimento=${conversationId}` } }
          : null;
      }
      const assignee = str(p.assigneeUserId);
      return assignee
        ? { userIds: [assignee], title: `Nova mensagem em ${number}`, body: str(p.preview), data: { conversationId, href: `/atendimento?conversa=${conversationId}` } }
        : null;
    }

    case 'support.assigned': {
      const conversationId = str(p.conversationId);
      const assignee = str(p.assigneeUserId);
      // Quem assumiu o próprio atendimento não precisa ser avisado.
      if (!conversationId || !assignee || assignee === str(p.actorUserId)) return null;
      return { userIds: [assignee], title: `Atendimento ${String(p.number ?? '')} atribuído a você`, body: null, data: { conversationId, href: `/atendimento?conversa=${conversationId}` } };
    }

    case 'support.status_changed': {
      const conversationId = str(p.conversationId);
      const requester = str(p.requesterUserId);
      if (!conversationId || !requester || p.to !== 'RESOLVED') return null;
      return {
        userIds: [requester],
        title: `Atendimento ${String(p.number ?? '')} resolvido`,
        body: 'Se precisar de mais ajuda, abra uma nova conversa pelo chat.',
        data: { conversationId, href: `/?atendimento=${conversationId}` },
      };
    }

    default:
      return null;
  }
}

/** Cria avisos in-app idempotentes por evento + usuário e sinaliza o stream de tempo real. */
export function notificationsHandler(ctx: WorkerContext, publisher: Redis) {
  return async (job: Job<OutboxJob>) => {
    const { tenantId, payload, type, eventId } = job.data;
    if (!tenantId) return;

    const created = await ctx.db.run(systemContext(tenantId), async (tx) => {
      const plan = await notificationPlan(tx, type, payload);
      if (!plan?.userIds.length) return [];
      const existing = await tx.notification.findMany({
        where: { userId: { in: plan.userIds }, data: { path: ['eventId'], equals: eventId } },
        select: { userId: true },
      });
      const already = new Set(existing.map((e) => e.userId));
      const targets = plan.userIds.filter((u) => !already.has(u));
      if (targets.length) {
        await tx.notification.createMany({
          data: targets.map((userId) => ({ tenantId, userId, type, title: plan.title, body: plan.body, data: { eventId, ...plan.data } })),
        });
      }
      return targets;
    });

    if (created.length) {
      const message: RealtimeMessage = { tenantId, kind: 'notification', keys: [['notifications']], userIds: created };
      await publisher.publish(REALTIME_CHANNEL, JSON.stringify(message));
    }
  };
}
