import {
  effectivePermissions,
  REALTIME_CHANNEL,
  SUPPORT_FIRST_RESPONSE_SLA_MINUTES,
  SUPPORT_QUEUE_LABELS,
  SUPPORT_QUEUE_SLUGS,
  type RealtimeMessage,
  type SupportQueue,
} from '@ordens/contracts';
import { systemContext } from '@ordens/db';
import type { Redis } from 'ioredis';
import type { WorkerContext } from '../context.js';

export interface SlaMember {
  userId: string;
  roles: string[];
  queues: string[];
  /** Permissões de papéis personalizados ativos (Q35). */
  extraPermissions?: string[];
}

/** Quem é avisado do SLA estourado: supervisão e atendentes da fila da conversa (Q30/Q31). */
export function slaRecipients(members: SlaMember[], queue: string): string[] {
  const ids = members
    .filter((m) => {
      const perms = effectivePermissions(m.roles, m.extraPermissions ?? []);
      return perms.has('support.manage') || (perms.has('support.attend') && m.queues.includes(queue));
    })
    .map((m) => m.userId);
  return [...new Set(ids)];
}

const time = (d: Date) => d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });

/**
 * Avisa uma vez por entrada na fila as conversas que passaram do prazo da 1ª resposta.
 * Idempotente por conversa + horário de entrada na fila (sla_notified_at e eventId da notificação).
 */
export async function notifySupportSla(ctx: WorkerContext, publisher: Redis, now = new Date()) {
  const cutoff = new Date(now.getTime() - SUPPORT_FIRST_RESPONSE_SLA_MINUTES * 60_000);
  const tenants = await ctx.db.system((tx) => tx.tenant.findMany({ where: { status: 'ACTIVE' }, select: { id: true } }));
  let total = 0;

  for (const { id: tenantId } of tenants) {
    const notified = await ctx.db.run(systemContext(tenantId), async (tx) => {
      const due = await tx.$queryRaw<{ id: string; number: string; queue: SupportQueue; queued_at: Date }[]>`
        select id, number, queue::text as queue, queued_at
        from support_conversations
        where status = 'WAITING' and queued_at < ${cutoff}
          and (sla_notified_at is null or sla_notified_at < queued_at)
        order by queued_at
        limit 100`;
      if (!due.length) return [];

      const memberships = await tx.membership.findMany({
        where: { scope: 'MATRIZ', status: 'ACTIVE', user: { status: 'ACTIVE' } },
        select: {
          userId: true,
          roles: { select: { roleCode: true } },
          supportQueues: { select: { queue: true } },
          customRoles: { where: { role: { status: 'ACTIVE' } }, select: { role: { select: { permissions: { select: { permissionCode: true } } } } } },
        },
      });
      const members: SlaMember[] = memberships.map((m) => ({
        userId: m.userId,
        roles: m.roles.map((r) => r.roleCode),
        queues: m.supportQueues.map((s) => s.queue),
        extraPermissions: m.customRoles.flatMap((c) => c.role.permissions.map((p) => p.permissionCode)),
      }));
      const users = new Set<string>();

      for (const conv of due) {
        const eventId = `support.sla:${conv.id}:${conv.queued_at.getTime()}`;
        const recipients = slaRecipients(members, conv.queue);
        const existing = recipients.length
          ? await tx.notification.findMany({ where: { userId: { in: recipients }, data: { path: ['eventId'], equals: eventId } }, select: { userId: true } })
          : [];
        const already = new Set(existing.map((e) => e.userId));
        const targets = recipients.filter((u) => !already.has(u));
        if (targets.length) {
          await tx.notification.createMany({
            data: targets.map((userId) => ({
              tenantId,
              userId,
              type: 'support.sla_breached',
              title: `Atendimento ${conv.number} passou do prazo de 1 h`,
              body: `Na fila de ${SUPPORT_QUEUE_LABELS[conv.queue]} sem resposta desde ${time(conv.queued_at)}.`,
              data: { eventId, conversationId: conv.id, href: `/atendimento/${SUPPORT_QUEUE_SLUGS[conv.queue]}?conversa=${conv.id}` },
            })),
          });
          targets.forEach((u) => users.add(u));
        }
        await tx.$executeRaw`update support_conversations set sla_notified_at = now() where id = ${conv.id}::uuid`;
      }
      return [...users];
    });

    if (notified.length) {
      total += notified.length;
      const messages: RealtimeMessage[] = [
        { tenantId, kind: 'notification', keys: [['notifications']], userIds: notified },
        { tenantId, kind: 'invalidate', keys: [['support']], internalOnly: true },
      ];
      for (const message of messages) await publisher.publish(REALTIME_CHANNEL, JSON.stringify(message));
    }
  }
  if (total) ctx.logger.info({ notified: total }, 'Avisos de SLA de atendimento enviados');
}
