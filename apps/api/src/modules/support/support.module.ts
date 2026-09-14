import { Body, Controller, Get, HttpCode, Injectable, Module, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  asksForAgent,
  classifySupportText,
  ErrorCode,
  findOrderNumber,
  permissionsForRoles,
  ROLES,
  SUPPORT_AGENT_TRANSITIONS,
  SUPPORT_BOT_OPTIONS,
  SUPPORT_FIRST_RESPONSE_SLA_MINUTES,
  SUPPORT_QUEUE_LABELS,
  SUPPORT_QUEUES,
  SUPPORT_RESPONSE_BUCKETS,
  SUPPORT_STATUS_LABELS,
  SUPPORT_STATUSES,
  supportAgentsQuery,
  supportAnalyticsQuery,
  supportAssignSchema,
  supportMessageSchema,
  supportQueueQuery,
  supportSlaState,
  supportStartSchema,
  supportSummaryQuery,
  supportTeamUpdateSchema,
  supportTransitionSchema,
  supportUpdateSchema,
  type CursorPage,
  type LookupOption,
  type Page,
  type SupportAgentsQuery,
  type SupportAnalytics,
  type SupportAnalyticsQuery,
  type SupportBotAction,
  type SupportBotOption,
  type SupportConversationDetail,
  type SupportConversationDto,
  type SupportPriority,
  type SupportQueue,
  type SupportQueueQuery,
  type SupportStatus,
  type SupportSummary,
  type SupportTeamMember,
  type SupportTeamUpdateResult,
} from '@ordens/contracts';
import { nextSequence, Prisma, type Tx, type UnitOfWorkScope } from '@ordens/db';
import type { z } from 'zod';
import { RequireAnyPermission, RequirePermission } from '../../common/decorators.js';
import { AppError } from '../../common/errors.js';
import { currentAuth, type AuthState } from '../../common/request-context.js';
import { ZodPipe } from '../../common/zod.pipe.js';
import { TenantDb } from '../../infra/tenant-db.service.js';
import { oneOf, uniq } from '../fiscal/fiscal.util.js';

type ConversationRow = NonNullable<Awaited<ReturnType<Tx['supportConversation']['findUnique']>>>;
type BotState = { step?: 'CHOOSE_QUEUE' | 'DESCRIBE' | 'DONE'; attempts?: number };
type MessageInput = z.output<typeof supportMessageSchema>;
/** Recorte de filas de uma consulta do atendimento; `includeNoQueue` = conversas ainda com o assistente (supervisão). */
type QueueScope = { queues: SupportQueue[]; includeNoQueue: boolean };
/** Filas atendidas pelo usuário da requisição (Q31). */
type Access = { queues: SupportQueue[]; supervisor: boolean };
type SqlRow = Record<string, bigint | Prisma.Decimal | number | string | null>;

const uuid = new ParseUUIDPipe({ errorHttpStatusCode: 404 });
const TZ = 'America/Sao_Paulo';
const SLA = SUPPORT_FIRST_RESPONSE_SLA_MINUTES;
const AGENT_OPTION: SupportBotOption = { action: 'AGENT', label: 'Falar com um atendente', hint: 'Vai direto para a fila de atendimento' };
const BOT_MENU: SupportBotOption[] = [...SUPPORT_BOT_OPTIONS, AGENT_OPTION];
/** Tentativas do assistente sem entender o assunto antes de encaminhar ao Suporte (Q27). */
const MAX_BOT_ATTEMPTS = 2;
const STAFF: Parameters<typeof RequireAnyPermission> = ['support.attend', 'support.manage'];
const ACTIVE_WORK = Prisma.sql`('WAITING', 'OPEN', 'PENDING_CUSTOMER')`;
const REQUESTER_KIND_LABELS: Record<string, string> = { MATRIZ: 'Matriz', FARM: 'Fazendas', BUYER: 'Compradores', CARRIER: 'Transportadoras', UNKNOWN: 'Outros' };
const TEAM_SELECT = {
  id: true,
  userId: true,
  roles: { select: { roleCode: true } },
  supportQueues: { select: { queue: true } },
  user: { select: { name: true, email: true, status: true } },
} satisfies Prisma.MembershipSelect;
type TeamRow = Prisma.MembershipGetPayload<{ select: typeof TEAM_SELECT }>;

const preview = (text: string) => (text.length > 120 ? `${text.slice(0, 117)}…` : text);
const minutes = (v: unknown) => (v === null || v === undefined ? null : Math.round(Number(v)));
const count = (v: unknown) => Number(v ?? 0);
const roleName = (code: string) => (ROLES as Record<string, { name: string }>)[code]?.name ?? code;

/** Membro da equipe: supervisão atende todas as filas; demais, as filas cadastradas (se o papel permite atender). */
function toTeamMember(m: TeamRow): SupportTeamMember {
  const roles = m.roles.map((r) => r.roleCode);
  const perms = permissionsForRoles(roles);
  const supervisor = perms.has('support.manage');
  const canAttend = supervisor || perms.has('support.attend');
  return {
    membershipId: m.id,
    userId: m.userId,
    name: m.user.name,
    email: m.user.email,
    roles: roles.map(roleName),
    supervisor,
    canAttend,
    queues: supervisor ? [...SUPPORT_QUEUES] : canAttend ? SUPPORT_QUEUES.filter((q) => m.supportQueues.some((s) => s.queue === q)) : [],
  };
}

@Injectable()
export class SupportService {
  /** Acesso calculado uma vez por requisição. */
  private readonly accessCache = new WeakMap<AuthState, Promise<Access>>();

  constructor(private readonly db: TenantDb) {}

  // ───────────────────────────── Cliente ─────────────────────────────

  mine(): Promise<SupportConversationDto[]> {
    const auth = currentAuth();
    return this.db.read(async (tx) =>
      this.toDtos(tx, await tx.supportConversation.findMany({ where: { requesterUserId: auth.userId }, orderBy: { lastMessageAt: 'desc' }, take: 30 })),
    );
  }

  detail(id: string): Promise<SupportConversationDetail> {
    return this.db.read((tx) => this.loadDetail(tx, id));
  }

  start(input: z.output<typeof supportStartSchema>): Promise<SupportConversationDetail> {
    const auth = currentAuth();
    const m = auth.membership!;
    return this.db.write(async (scope) => {
      const { tx, audit, outbox } = scope;
      const year = new Date().getUTCFullYear();
      const number = `ATD-${year}-${String(await nextSequence(tx, m.tenantId, 'support', year)).padStart(4, '0')}`;
      const order = input.orderId ? await tx.loadingOrder.findUnique({ where: { id: input.orderId }, select: { id: true } }) : null;
      if (input.orderId && !order) throw AppError.notFound('Ordem não encontrada.');

      const conv = await tx.supportConversation.create({
        data: {
          tenantId: m.tenantId,
          number,
          requesterUserId: auth.userId,
          requesterOrgId: m.organizationId,
          status: 'BOT',
          botState: { step: 'CHOOSE_QUEUE', attempts: 0 },
          orderId: order?.id ?? null,
        },
      });
      await audit({ entityType: 'support_conversation', entityId: conv.id, action: 'support.conversation_started', after: { number, orderId: conv.orderId } });

      const firstName = auth.userName.split(' ')[0] ?? '';
      const text = input.message?.trim();
      if (text) {
        await this.addMessage(tx, conv, { authorType: 'CUSTOMER', authorUserId: auth.userId, body: text });
        await this.runBot(scope, conv, text, undefined, firstName);
      } else {
        await this.addMessage(tx, conv, { authorType: 'BOT', body: `Olá, ${firstName}! Sou o assistente de atendimento. Sobre o que você precisa de ajuda?`, options: BOT_MENU });
      }
      await outbox({ type: 'support.conversation_started', aggregateType: 'support_conversation', aggregateId: conv.id, payload: { conversationId: conv.id, number, requesterUserId: auth.userId } });
      return this.loadDetail(tx, conv.id);
    });
  }

  post(id: string, input: MessageInput): Promise<SupportConversationDetail> {
    const auth = currentAuth();
    return this.db.write(async (scope) => {
      const { tx, audit, outbox } = scope;
      const conv = await this.lock(tx, id);
      const agent = this.isAgentFor(await this.access(tx), conv);
      if (!agent && conv.requesterUserId !== auth.userId) throw AppError.notFound('Conversa não encontrada.');
      if (conv.status === 'CLOSED') throw AppError.domain(ErrorCode.INVALID_TRANSITION, 'Esta conversa foi encerrada. Abra uma nova conversa para continuar.');
      const text = input.body.trim();

      if (agent) {
        if (conv.status === 'BOT') throw AppError.domain(ErrorCode.INVALID_TRANSITION, 'A conversa ainda está com o assistente de triagem.');
        if (!text) throw AppError.validation({ fields: { body: ['Escreva uma mensagem'] } });
        await this.addMessage(tx, conv, { authorType: 'AGENT', authorUserId: auth.userId, body: text, internal: input.internal });
        const assigneeUserId = conv.assigneeUserId ?? auth.userId;
        if (!input.internal) {
          const now = new Date();
          // Resposta pública em conversa sem responsável assume o atendimento (Q29).
          await tx.supportConversation.update({
            where: { id },
            data: { lastMessageAt: now, firstResponseAt: conv.firstResponseAt ?? now, assigneeUserId, ...(conv.status === 'WAITING' ? { status: 'OPEN' } : {}) },
          });
          if (conv.status === 'WAITING' || !conv.assigneeUserId) {
            await audit({ entityType: 'support_conversation', entityId: id, action: 'support.status_changed', before: { status: conv.status, assigneeUserId: conv.assigneeUserId }, after: { status: 'OPEN', assigneeUserId } });
          }
        }
        await outbox({
          type: 'support.message_created',
          aggregateType: 'support_conversation',
          aggregateId: id,
          payload: { conversationId: id, number: conv.number, requesterUserId: conv.requesterUserId, assigneeUserId, fromAgent: true, internal: input.internal, preview: input.internal ? null : preview(text) },
        });
        return this.loadDetail(tx, id);
      }

      if (input.internal) throw AppError.forbidden('Notas internas são exclusivas do atendimento.');
      // Conversa resolvida não reabre pelo cliente (Q29): outro assunto vira nova conversa.
      if (conv.status === 'RESOLVED') {
        throw AppError.domain(ErrorCode.INVALID_TRANSITION, 'Esta conversa foi resolvida e não pode ser reaberta. Abra uma nova conversa se precisar de ajuda.');
      }
      // Botão do assistente vira mensagem do cliente com o rótulo escolhido (o histórico mostra a escolha).
      const quickLabel = !text && input.quickReply ? BOT_MENU.find((o) => o.action === input.quickReply)?.label : undefined;
      if (text || quickLabel) await this.addMessage(tx, conv, { authorType: 'CUSTOMER', authorUserId: auth.userId, body: text || quickLabel! });

      if (conv.status === 'BOT') {
        await this.runBot(scope, conv, text, input.quickReply, auth.userName.split(' ')[0] ?? '');
        return this.loadDetail(tx, id);
      }
      if (!text) throw AppError.validation({ fields: { body: ['Escreva uma mensagem'] } });

      await tx.supportConversation.update({
        where: { id },
        data: { lastMessageAt: new Date(), ...(conv.status === 'PENDING_CUSTOMER' ? { status: 'OPEN' } : {}) },
      });
      await outbox({
        type: 'support.message_created',
        aggregateType: 'support_conversation',
        aggregateId: id,
        payload: { conversationId: id, number: conv.number, requesterUserId: conv.requesterUserId, assigneeUserId: conv.assigneeUserId, fromAgent: false, internal: false, preview: preview(text) },
      });
      return this.loadDetail(tx, id);
    });
  }

  close(id: string): Promise<SupportConversationDetail> {
    const auth = currentAuth();
    return this.db.write(async ({ tx, audit, outbox }) => {
      const conv = await this.lock(tx, id);
      if (conv.requesterUserId !== auth.userId) throw AppError.notFound('Conversa não encontrada.');
      if (conv.status === 'CLOSED') return this.loadDetail(tx, id);
      const now = new Date();
      await tx.supportConversation.update({ where: { id }, data: { status: 'CLOSED', closedAt: now, lastMessageAt: now } });
      await this.addMessage(tx, conv, { authorType: 'BOT', body: 'Conversa encerrada. Se precisar de algo mais, é só abrir uma nova.' });
      await audit({ entityType: 'support_conversation', entityId: id, action: 'support.status_changed', before: { status: conv.status }, after: { status: 'CLOSED', reason: 'encerrada pelo cliente' } });
      await outbox({ type: 'support.status_changed', aggregateType: 'support_conversation', aggregateId: id, payload: { conversationId: id, number: conv.number, to: 'CLOSED', requesterUserId: conv.requesterUserId } });
      return this.loadDetail(tx, id);
    });
  }

  // ───────────────────────────── Atendimento ─────────────────────────────

  queue(q: SupportQueueQuery): Promise<Page<SupportConversationDto>> {
    const auth = currentAuth();
    return this.db.read(async (tx) => {
      const scope = this.scopeFor(await this.access(tx), q.queue);
      const status = oneOf(SUPPORT_STATUSES, q.status);
      const where: Prisma.SupportConversationWhereInput = {
        AND: [
          this.scopeWhere(scope),
          { status: status?.length ? { in: status } : { in: ['WAITING', 'OPEN', 'PENDING_CUSTOMER'] } },
          q.priority ? { priority: q.priority } : {},
          q.assignee === 'me' ? { assigneeUserId: auth.userId } : q.assignee === 'none' ? { assigneeUserId: null } : q.assignee ? { assigneeUserId: q.assignee } : {},
          q.q ? { OR: [{ number: { contains: q.q, mode: 'insensitive' } }, { subject: { contains: q.q, mode: 'insensitive' } }] } : {},
        ],
      };
      const [total, rows] = await Promise.all([
        tx.supportConversation.count({ where }),
        tx.supportConversation.findMany({
          where,
          orderBy: [{ priority: 'desc' }, { queuedAt: { sort: 'asc', nulls: 'last' } }, { lastMessageAt: 'desc' }],
          skip: (q.page - 1) * q.pageSize,
          take: q.pageSize,
        }),
      ]);
      return { total, page: q.page, pageSize: q.pageSize, items: await this.toDtos(tx, rows) };
    });
  }

  summary(queue?: SupportQueue): Promise<SupportSummary> {
    const auth = currentAuth();
    return this.db.read(async (tx) => {
      const scope = this.scopeFor(await this.access(tx), queue);
      const [r] = await tx.$queryRaw<SqlRow[]>(Prisma.sql`
        select
          count(*) filter (where status = 'WAITING' and queue = 'BILLING') as waiting_billing,
          count(*) filter (where status = 'WAITING' and queue = 'SUPPORT') as waiting_support,
          count(*) filter (where status = 'OPEN') as open,
          count(*) filter (where status = 'PENDING_CUSTOMER') as pending_customer,
          count(*) filter (where status in ${ACTIVE_WORK} and assignee_user_id is null) as unassigned,
          count(*) filter (where status in ${ACTIVE_WORK} and assignee_user_id = ${auth.userId}::uuid) as mine,
          count(*) filter (where resolved_at >= (date_trunc('day', now() at time zone ${TZ}) at time zone ${TZ})) as resolved_today,
          count(*) filter (where status = 'WAITING' and queued_at < now() - make_interval(mins => ${SLA}::int)) as sla_breached,
          extract(epoch from now() - min(queued_at) filter (where status = 'WAITING')) / 60 as oldest_waiting,
          avg(extract(epoch from first_response_at - queued_at) / 60) filter (where first_response_at is not null and first_response_at >= queued_at and queued_at >= now() - interval '7 days') as avg_first_response
        from support_conversations c
        where ${this.scopeSql(scope)}
      `);
      return {
        waiting: { BILLING: count(r?.waiting_billing), SUPPORT: count(r?.waiting_support) },
        open: count(r?.open),
        pendingCustomer: count(r?.pending_customer),
        unassigned: count(r?.unassigned),
        mine: count(r?.mine),
        resolvedToday: count(r?.resolved_today),
        oldestWaitingMinutes: minutes(r?.oldest_waiting),
        avgFirstResponseMinutes: minutes(r?.avg_first_response),
        slaBreached: count(r?.sla_breached),
      };
    });
  }

  /** Indicadores do período, recortados pelas filas do usuário (Q32). */
  analytics(q: SupportAnalyticsQuery): Promise<SupportAnalytics> {
    const days = q.days;
    return this.db.read(async (tx) => {
      const scope = this.scopeFor(await this.access(tx), q.queue);
      const start = Prisma.sql`((date_trunc('day', now() at time zone ${TZ}) - make_interval(days => ${days - 1}::int)) at time zone ${TZ})`;
      const prevStart = Prisma.sql`((date_trunc('day', now() at time zone ${TZ}) - make_interval(days => ${2 * days - 1}::int)) at time zone ${TZ})`;
      const scoped = Prisma.sql`
        scoped as (
          select c.*,
            extract(epoch from c.first_response_at - c.created_at) / 60 as frt,
            extract(epoch from c.resolved_at - c.created_at) / 60 as rt
          from support_conversations c
          where ${this.scopeSql(scope)}
        )`;

      const [totals] = await tx.$queryRaw<SqlRow[]>(Prisma.sql`
        with ${scoped}
        select
          count(*) filter (where created_at >= ${start}) as opened,
          count(*) filter (where created_at >= ${start} and queue is not null) as queued,
          count(*) filter (where resolved_at >= ${start}) as resolved,
          count(*) filter (where created_at >= ${start} and queue is null and status = 'CLOSED') as abandoned,
          count(*) filter (where status in ${ACTIVE_WORK}) as backlog,
          count(*) filter (where status in ${ACTIVE_WORK} and assignee_user_id is null) as unassigned,
          count(*) filter (where status = 'WAITING' and queued_at < now() - make_interval(mins => ${SLA}::int)) as sla_breached_now,
          count(*) filter (where created_at >= ${start} and first_response_at is not null) as responded,
          count(*) filter (where created_at >= ${start} and first_response_at is not null and frt <= ${SLA}) as within_sla,
          avg(frt) filter (where created_at >= ${start} and first_response_at is not null) as avg_frt,
          percentile_cont(0.9) within group (order by frt) filter (where created_at >= ${start} and first_response_at is not null) as p90_frt,
          avg(rt) filter (where resolved_at >= ${start}) as avg_rt,
          count(*) filter (where created_at >= ${start} and queue is not null and status in ('RESOLVED', 'CLOSED')) as done_of_queued,
          count(*) filter (where created_at >= ${prevStart} and created_at < ${start}) as prev_opened,
          count(*) filter (where resolved_at >= ${prevStart} and resolved_at < ${start}) as prev_resolved,
          avg(frt) filter (where created_at >= ${prevStart} and created_at < ${start} and first_response_at is not null) as prev_avg_frt
        from scoped
      `);

      const daily = await tx.$queryRaw<SqlRow[]>(Prisma.sql`
        with ${scoped},
        days as (
          select generate_series((now() at time zone ${TZ})::date - ${days - 1}::int, (now() at time zone ${TZ})::date, interval '1 day')::date as d
        ),
        o as (select (created_at at time zone ${TZ})::date as d, count(*) as n from scoped where created_at >= ${start} group by 1),
        r as (select (resolved_at at time zone ${TZ})::date as d, count(*) as n from scoped where resolved_at >= ${start} group by 1)
        select to_char(days.d, 'YYYY-MM-DD') as day, coalesce(o.n, 0) as opened, coalesce(r.n, 0) as resolved
        from days left join o using (d) left join r using (d)
        order by days.d
      `);

      const byStatus = await tx.$queryRaw<SqlRow[]>(Prisma.sql`
        with ${scoped}
        select status::text as key, count(*) as n from scoped
        where status in ('BOT', 'WAITING', 'OPEN', 'PENDING_CUSTOMER') group by 1
      `);
      const byPriority = await tx.$queryRaw<SqlRow[]>(Prisma.sql`
        with ${scoped}
        select priority::text as key, count(*) as n from scoped where status in ${ACTIVE_WORK} group by 1
      `);
      const buckets = await tx.$queryRaw<SqlRow[]>(Prisma.sql`
        with ${scoped}
        select case when frt < 15 then 'lt15' when frt < 60 then 'lt60' when frt < 240 then 'lt240' when frt < 1440 then 'lt1440' else 'gte1440' end as key, count(*) as n
        from scoped where created_at >= ${start} and first_response_at is not null group by 1
      `);
      const byHour = await tx.$queryRaw<SqlRow[]>(Prisma.sql`
        with ${scoped}
        select extract(hour from created_at at time zone ${TZ})::int as key, count(*) as n from scoped where created_at >= ${start} group by 1
      `);
      const byQueue = await tx.$queryRaw<SqlRow[]>(Prisma.sql`
        with ${scoped}
        select queue::text as queue,
          count(*) filter (where created_at >= ${start}) as opened,
          count(*) filter (where resolved_at >= ${start}) as resolved,
          count(*) filter (where status in ${ACTIVE_WORK}) as backlog,
          avg(frt) filter (where created_at >= ${start} and first_response_at is not null) as avg_frt,
          avg(rt) filter (where resolved_at >= ${start}) as avg_rt
        from scoped where queue is not null group by queue
      `);
      const byRequester = await tx.$queryRaw<SqlRow[]>(Prisma.sql`
        with ${scoped}
        select coalesce(o.kind::text, 'UNKNOWN') as key, count(*) as n
        from scoped s left join organizations o on o.id = s.requester_org_id
        where s.created_at >= ${start} group by 1 order by 2 desc
      `);
      const agentRows = await tx.$queryRaw<SqlRow[]>(Prisma.sql`
        with ${scoped}
        select assignee_user_id::text as id,
          count(*) filter (where status in ${ACTIVE_WORK}) as open_now,
          count(*) filter (where resolved_at >= ${start}) as resolved,
          avg(frt) filter (where created_at >= ${start} and first_response_at is not null) as avg_frt
        from scoped where assignee_user_id is not null group by 1
      `);
      const replyRows = await tx.$queryRaw<SqlRow[]>(Prisma.sql`
        with ${scoped}
        select m.author_user_id::text as id, count(*) as n
        from support_messages m join scoped s on s.id = m.conversation_id
        where m.author_type = 'AGENT' and not m.internal and m.author_user_id is not null and m.created_at >= ${start}
        group by 1
      `);

      const tally = (rows: SqlRow[]) => new Map(rows.map((r) => [String(r.key), count(r.n)]));
      const statusCounts = tally(byStatus);
      const priorityCounts = tally(byPriority);
      const bucketCounts = tally(buckets);
      const hourCounts = tally(byHour);
      const replies = new Map(replyRows.map((r) => [String(r.id), count(r.n)]));
      const agentIds = uniq([...agentRows.map((r) => String(r.id)), ...replies.keys()]);
      const users = agentIds.length ? await tx.user.findMany({ where: { id: { in: agentIds } }, select: { id: true, name: true } }) : [];
      const names = new Map(users.map((u) => [u.id, u.name]));
      const agentStats = new Map(agentRows.map((r) => [String(r.id), r]));
      const queued = count(totals?.queued);
      const responded = count(totals?.responded);

      return {
        days,
        queues: scope.queues,
        generatedAt: new Date().toISOString(),
        totals: {
          opened: count(totals?.opened),
          queued,
          resolved: count(totals?.resolved),
          abandonedInBot: count(totals?.abandoned),
          backlog: count(totals?.backlog),
          unassigned: count(totals?.unassigned),
          avgFirstResponseMinutes: minutes(totals?.avg_frt),
          p90FirstResponseMinutes: minutes(totals?.p90_frt),
          avgResolutionMinutes: minutes(totals?.avg_rt),
          resolutionRate: queued ? Math.round((count(totals?.done_of_queued) / queued) * 100) : null,
          firstResponseWithinSlaRate: responded ? Math.round((count(totals?.within_sla) / responded) * 100) : null,
          slaBreachedNow: count(totals?.sla_breached_now),
        },
        previous: { opened: count(totals?.prev_opened), resolved: count(totals?.prev_resolved), avgFirstResponseMinutes: minutes(totals?.prev_avg_frt) },
        daily: daily.map((d) => ({ day: String(d.day), opened: count(d.opened), resolved: count(d.resolved) })),
        backlogByStatus: (['WAITING', 'OPEN', 'PENDING_CUSTOMER', ...(scope.includeNoQueue ? (['BOT'] as const) : [])] as SupportStatus[]).map((status) => ({
          status,
          count: statusCounts.get(status) ?? 0,
        })),
        backlogByPriority: (['URGENT', 'HIGH', 'NORMAL', 'LOW'] as SupportPriority[]).map((priority) => ({ priority, count: priorityCounts.get(priority) ?? 0 })),
        firstResponseBuckets: SUPPORT_RESPONSE_BUCKETS.map((b) => ({ key: b.key, label: b.label, count: bucketCounts.get(b.key) ?? 0 })),
        byHour: Array.from({ length: 24 }, (_, hour) => ({ hour, count: hourCounts.get(String(hour)) ?? 0 })),
        byQueue: scope.queues.map((queue) => {
          const r = byQueue.find((x) => x.queue === queue);
          return {
            queue,
            opened: count(r?.opened),
            resolved: count(r?.resolved),
            backlog: count(r?.backlog),
            avgFirstResponseMinutes: minutes(r?.avg_frt),
            avgResolutionMinutes: minutes(r?.avg_rt),
          };
        }),
        byRequester: byRequester.map((r) => ({ kind: String(r.key), label: REQUESTER_KIND_LABELS[String(r.key)] ?? String(r.key), count: count(r.n) })),
        agents: agentIds
          .map((id) => {
            const s = agentStats.get(id);
            return { id, name: names.get(id) ?? 'Atendente', openNow: count(s?.open_now), resolved: count(s?.resolved), replies: replies.get(id) ?? 0, avgFirstResponseMinutes: minutes(s?.avg_frt) };
          })
          .filter((a) => a.openNow || a.resolved || a.replies)
          .sort((a, b) => b.resolved - a.resolved || b.replies - a.replies || a.name.localeCompare(b.name)),
      };
    });
  }

  agents(q: SupportAgentsQuery): Promise<CursorPage<LookupOption>> {
    return this.db.read(async (tx) => {
      const scope = this.scopeFor(await this.access(tx), q.queue);
      const eligible = await this.eligibleAgents(tx, q.queue ?? null, scope.queues);
      const users = await tx.user.findMany({
        where: {
          id: { in: eligible },
          ...(q.q ? { OR: [{ name: { contains: q.q, mode: 'insensitive' } }, { email: { contains: q.q, mode: 'insensitive' } }] } : {}),
        },
        orderBy: { name: 'asc' },
        take: 50,
        select: { id: true, name: true, email: true },
      });
      return { nextCursor: null, items: users.map((u) => ({ id: u.id, label: u.name, description: u.email })) };
    });
  }

  assign(id: string, assigneeUserId: string | null): Promise<SupportConversationDetail> {
    const auth = currentAuth();
    return this.db.write(async ({ tx, audit, outbox }) => {
      const conv = await this.lockForAgent(tx, id);
      if (conv.status === 'CLOSED') throw AppError.domain(ErrorCode.INVALID_TRANSITION, 'Conversa encerrada.');
      let name: string | null = null;
      if (assigneeUserId) {
        // Responsável precisa atender a fila da conversa (Q31).
        const eligible = await this.eligibleAgents(tx, conv.queue, [...SUPPORT_QUEUES]);
        if (!eligible.includes(assigneeUserId)) {
          throw AppError.validation({ fields: { assigneeUserId: [conv.queue ? `Selecione alguém da fila de ${SUPPORT_QUEUE_LABELS[conv.queue]}` : 'Selecione um atendente da Matriz'] } });
        }
        name = (await tx.user.findUnique({ where: { id: assigneeUserId }, select: { name: true } }))?.name ?? null;
      }
      if (conv.assigneeUserId === assigneeUserId) return this.loadDetail(tx, id);
      await tx.supportConversation.update({ where: { id }, data: { assigneeUserId } });
      await this.addMessage(tx, conv, { authorType: 'SYSTEM', body: assigneeUserId ? `Atendimento com ${name ?? 'um atendente'}.` : 'Atendimento sem responsável no momento.' });
      await audit({ entityType: 'support_conversation', entityId: id, action: 'support.assigned', before: { assigneeUserId: conv.assigneeUserId }, after: { assigneeUserId } });
      await outbox({
        type: 'support.assigned',
        aggregateType: 'support_conversation',
        aggregateId: id,
        payload: { conversationId: id, number: conv.number, assigneeUserId, actorUserId: auth.userId, requesterUserId: conv.requesterUserId },
      });
      return this.loadDetail(tx, id);
    });
  }

  transition(id: string, to: SupportStatus): Promise<SupportConversationDetail> {
    return this.db.write(async ({ tx, audit, outbox }) => {
      const conv = await this.lockForAgent(tx, id);
      if (!SUPPORT_AGENT_TRANSITIONS[conv.status].includes(to)) {
        throw AppError.domain(ErrorCode.INVALID_TRANSITION, `Não é possível passar de "${SUPPORT_STATUS_LABELS[conv.status]}" para "${SUPPORT_STATUS_LABELS[to]}".`);
      }
      if (to === 'WAITING' && !conv.queue) throw AppError.domain(ErrorCode.INVALID_TRANSITION, 'Defina a fila antes de colocar a conversa em espera.');
      const now = new Date();
      await tx.supportConversation.update({
        where: { id },
        data: {
          status: to,
          lastMessageAt: now,
          ...(to === 'RESOLVED' ? { resolvedAt: now } : {}),
          ...(to === 'CLOSED' ? { closedAt: now } : {}),
          ...(to === 'OPEN' && conv.status === 'RESOLVED' ? { resolvedAt: null } : {}),
          ...(to === 'WAITING' ? { queuedAt: now } : {}),
        },
      });
      await this.addMessage(tx, conv, { authorType: 'SYSTEM', body: `Status: ${SUPPORT_STATUS_LABELS[to]}.` });
      await audit({ entityType: 'support_conversation', entityId: id, action: 'support.status_changed', before: { status: conv.status }, after: { status: to } });
      await outbox({ type: 'support.status_changed', aggregateType: 'support_conversation', aggregateId: id, payload: { conversationId: id, number: conv.number, to, requesterUserId: conv.requesterUserId } });
      return this.loadDetail(tx, id);
    });
  }

  update(id: string, input: z.output<typeof supportUpdateSchema>): Promise<SupportConversationDetail | null> {
    return this.db.write(async ({ tx, audit, outbox }) => {
      const conv = await this.lockForAgent(tx, id);
      if (conv.status === 'CLOSED') throw AppError.domain(ErrorCode.INVALID_TRANSITION, 'Conversa encerrada.');
      const transfer = input.queue && input.queue !== conv.queue;
      await tx.supportConversation.update({
        where: { id },
        // Transferência libera o responsável e devolve a conversa à fila de destino (Q28).
        data: {
          ...(input.priority ? { priority: input.priority } : {}),
          ...(transfer
            ? { queue: input.queue, assigneeUserId: null, ...(conv.status === 'OPEN' || conv.status === 'PENDING_CUSTOMER' ? { status: 'WAITING', queuedAt: new Date() } : {}) }
            : {}),
        },
      });
      if (transfer) await this.addMessage(tx, conv, { authorType: 'SYSTEM', body: `Transferida para ${SUPPORT_QUEUE_LABELS[input.queue!]}. Aguardando atendimento.` });
      await audit({
        entityType: 'support_conversation',
        entityId: id,
        action: 'support.updated',
        before: { queue: conv.queue, priority: conv.priority, assigneeUserId: conv.assigneeUserId },
        after: { queue: input.queue ?? conv.queue, priority: input.priority ?? conv.priority, assigneeUserId: transfer ? null : conv.assigneeUserId },
      });
      await outbox({ type: 'support.updated', aggregateType: 'support_conversation', aggregateId: id, payload: { conversationId: id, number: conv.number, requesterUserId: conv.requesterUserId } });
      // Transferida para uma fila que o atendente não atende: a conversa sai do alcance dele (Q31).
      const after = await tx.supportConversation.findUniqueOrThrow({ where: { id } });
      return this.handles(await this.access(tx), after) ? this.loadDetail(tx, id) : null;
    });
  }

  // ───────────────────────────── Equipe (Q31) ─────────────────────────────

  team(): Promise<SupportTeamMember[]> {
    return this.db.read(async (tx) => {
      const rows = await tx.membership.findMany({ where: { scope: 'MATRIZ', status: 'ACTIVE', user: { status: 'ACTIVE' } }, select: TEAM_SELECT });
      return rows.map(toTeamMember).sort((a, b) => Number(b.supervisor) - Number(a.supervisor) || Number(b.canAttend) - Number(a.canAttend) || a.name.localeCompare(b.name));
    });
  }

  /** Define as filas de um atendente. Sair de uma fila devolve à fila as conversas dele naquela fila. */
  updateTeamMember(membershipId: string, queues: SupportQueue[]): Promise<SupportTeamUpdateResult> {
    const auth = currentAuth();
    return this.db.write(async ({ tx, audit, outbox }) => {
      const row = await tx.membership.findFirst({ where: { id: membershipId, scope: 'MATRIZ', status: 'ACTIVE' }, select: TEAM_SELECT });
      if (!row) throw AppError.notFound('Usuário não encontrado na Matriz.');
      const member = toTeamMember(row);
      if (member.supervisor) throw AppError.domain(ErrorCode.INVALID_TRANSITION, 'Gestores e administradores supervisionam e já atendem todas as filas.');
      if (!member.canAttend) {
        throw AppError.validation({ fields: { queues: ['Este usuário não tem permissão de atendente. Atribua o papel Operador ou Atendente antes de incluí-lo em uma fila.'] } });
      }
      const wanted = SUPPORT_QUEUES.filter((q) => queues.includes(q));
      const removed = member.queues.filter((q) => !wanted.includes(q));
      const added = wanted.filter((q) => !member.queues.includes(q));
      if (!removed.length && !added.length) return { member, releasedConversations: 0 };

      if (removed.length) await tx.supportQueueMember.deleteMany({ where: { membershipId, queue: { in: removed } } });
      if (added.length) {
        await tx.supportQueueMember.createMany({ data: added.map((queue) => ({ tenantId: auth.membership!.tenantId, membershipId, queue, createdBy: auth.userId })) });
      }

      let released = 0;
      if (removed.length) {
        const orphaned = await tx.supportConversation.findMany({
          where: { assigneeUserId: row.userId, queue: { in: removed }, status: { in: ['WAITING', 'OPEN', 'PENDING_CUSTOMER'] } },
        });
        for (const conv of orphaned) {
          await tx.supportConversation.update({
            where: { id: conv.id },
            data: { assigneeUserId: null, ...(conv.status !== 'WAITING' ? { status: 'WAITING', queuedAt: new Date() } : {}) },
          });
          await this.addMessage(tx, conv, { authorType: 'SYSTEM', body: `${row.user.name} saiu da fila de ${SUPPORT_QUEUE_LABELS[conv.queue!]}. Aguardando atendimento.` });
          await audit({
            entityType: 'support_conversation',
            entityId: conv.id,
            action: 'support.assigned',
            before: { assigneeUserId: conv.assigneeUserId, status: conv.status },
            after: { assigneeUserId: null, status: 'WAITING', reason: 'atendente removido da fila' },
          });
          await outbox({ type: 'support.updated', aggregateType: 'support_conversation', aggregateId: conv.id, payload: { conversationId: conv.id, number: conv.number, requesterUserId: conv.requesterUserId } });
          released++;
        }
      }

      await audit({ entityType: 'support_team', entityId: membershipId, action: 'support.team_updated', before: { userId: row.userId, queues: member.queues }, after: { userId: row.userId, queues: wanted } });
      await outbox({ type: 'support.team_updated', aggregateType: 'membership', aggregateId: membershipId, payload: { membershipId, userId: row.userId, queues: wanted } });
      return { member: { ...member, queues: wanted }, releasedConversations: released };
    });
  }

  // ───────────────────────────── Assistente ─────────────────────────────

  private async runBot(scope: UnitOfWorkScope, conv: ConversationRow, text: string, quickReply: SupportBotAction | undefined, firstName: string) {
    const { tx, audit, outbox } = scope;
    const state = (conv.botState ?? {}) as BotState;
    const chosen: SupportQueue | null = quickReply === 'BILLING' || quickReply === 'SUPPORT' ? quickReply : null;
    const wantsAgent = quickReply === 'AGENT' || (text ? asksForAgent(text) : false);
    const classified = text ? classifySupportText(text) : null;

    const finalize = async (queue: SupportQueue, description: string | null, lead?: string) => {
      let orderId = conv.orderId;
      let orderNote = '';
      const orderNumber = description ? findOrderNumber(description) : null;
      if (!orderId && orderNumber) {
        // Busca sob o RLS de quem abriu: só vincula ordens que ele pode ver.
        const order = await tx.loadingOrder.findFirst({ where: { number: orderNumber }, select: { id: true, number: true } });
        if (order) {
          orderId = order.id;
          orderNote = ` Vinculei a ordem ${order.number}.`;
        }
      }
      const now = new Date();
      await tx.supportConversation.update({
        where: { id: conv.id },
        data: {
          queue,
          status: 'WAITING',
          queuedAt: now,
          lastMessageAt: now,
          botState: { step: 'DONE' },
          orderId,
          ...(description && !conv.subject ? { subject: description.slice(0, 160) } : {}),
        },
      });
      await this.addMessage(tx, conv, {
        authorType: 'BOT',
        body: `${lead ? `${lead} ` : ''}Pronto! A conversa ${conv.number} está na fila de ${SUPPORT_QUEUE_LABELS[queue]}.${orderNote} Um atendente vai responder por aqui; você pode continuar escrevendo enquanto isso.`,
      });
      await audit({ entityType: 'support_conversation', entityId: conv.id, action: 'support.conversation_queued', after: { queue, orderId } });
      await outbox({ type: 'support.conversation_queued', aggregateType: 'support_conversation', aggregateId: conv.id, payload: { conversationId: conv.id, number: conv.number, queue, requesterUserId: conv.requesterUserId } });
    };

    if (state.step === 'DESCRIBE' && conv.queue && text) return finalize(conv.queue, text);
    if (wantsAgent) return finalize(chosen ?? conv.queue ?? classified ?? 'SUPPORT', quickReply === 'AGENT' ? null : text || null);
    if (chosen && !text) {
      await tx.supportConversation.update({ where: { id: conv.id }, data: { queue: chosen, botState: { step: 'DESCRIBE', attempts: 0 } } });
      await this.addMessage(tx, conv, {
        authorType: 'BOT',
        body: `Certo, ${SUPPORT_QUEUE_LABELS[chosen]}. Descreva em poucas palavras o que você precisa. Se for sobre uma ordem, informe o número (ex.: 2026/00033).`,
      });
      return;
    }
    const queue = chosen ?? classified;
    if (queue) return finalize(queue, text || null);

    const attempts = (state.attempts ?? 0) + 1;
    if (attempts > MAX_BOT_ATTEMPTS) {
      return finalize('SUPPORT', text || null, 'Não consegui identificar o assunto, então encaminhei ao Suporte, que direciona sua demanda.');
    }
    await tx.supportConversation.update({ where: { id: conv.id }, data: { botState: { step: 'CHOOSE_QUEUE', attempts } } });
    await this.addMessage(tx, conv, {
      authorType: 'BOT',
      body:
        attempts === 1
          ? `Olá, ${firstName}! Para te direcionar ao time certo, escolha uma das opções abaixo.`
          : 'Não entendi bem. Escolha uma das opções ou escreva, por exemplo, "problema com a NF-e" ou "não consigo acessar".',
      options: BOT_MENU,
    });
  }

  // ───────────────────────────── Internos ─────────────────────────────

  /** Filas do usuário (Q31): supervisão atende todas; atendente, as filas cadastradas na equipe. */
  private access(tx: Tx): Promise<Access> {
    const auth = currentAuth();
    let cached = this.accessCache.get(auth);
    if (!cached) {
      cached = (async () => {
        if (auth.membership?.scope !== 'MATRIZ') return { queues: [], supervisor: false };
        if (auth.permissions.has('support.manage')) return { queues: [...SUPPORT_QUEUES], supervisor: true };
        if (!auth.permissions.has('support.attend')) return { queues: [], supervisor: false };
        const rows = await tx.supportQueueMember.findMany({ where: { membershipId: auth.membership.id }, select: { queue: true } });
        return { queues: SUPPORT_QUEUES.filter((q) => rows.some((r) => r.queue === q)), supervisor: false };
      })();
      this.accessCache.set(auth, cached);
    }
    return cached;
  }

  private scopeFor(access: Access, requested?: SupportQueue): QueueScope {
    if (!access.queues.length) throw AppError.forbidden('Você não está em nenhuma fila do atendimento. Peça à supervisão para incluir você na equipe.');
    if (requested && !access.queues.includes(requested)) throw AppError.forbidden(`Você não atende a fila de ${SUPPORT_QUEUE_LABELS[requested]}.`);
    return { queues: requested ? [requested] : access.queues, includeNoQueue: !requested && access.supervisor };
  }

  private scopeWhere(scope: QueueScope): Prisma.SupportConversationWhereInput {
    return scope.includeNoQueue ? { OR: [{ queue: { in: scope.queues } }, { queue: null }] } : { queue: { in: scope.queues } };
  }

  /** Filtro SQL equivalente a scopeWhere (alias `c`). */
  private scopeSql(scope: QueueScope) {
    const inQueues = Prisma.sql`c.queue::text in (${Prisma.join(scope.queues)})`;
    return scope.includeNoQueue ? Prisma.sql`(${inQueues} or c.queue is null)` : inQueues;
  }

  /** Atende a fila da conversa (sem fila = ainda com o assistente: só supervisão). */
  private handles(access: Access, conv: { queue: SupportQueue | null }) {
    return conv.queue ? access.queues.includes(conv.queue) : access.supervisor;
  }

  /** Atendente: atende a fila e age em conversa aberta por outra pessoa. */
  private isAgentFor(access: Access, conv: { requesterUserId: string; queue: SupportQueue | null }) {
    return this.handles(access, conv) && conv.requesterUserId !== currentAuth().userId;
  }

  /** Usuários da Matriz ativos que atendem `queue` (ou alguma das `within`, quando sem fila). */
  private async eligibleAgents(tx: Tx, queue: SupportQueue | null, within: SupportQueue[]): Promise<string[]> {
    const rows = await tx.membership.findMany({ where: { scope: 'MATRIZ', status: 'ACTIVE', user: { status: 'ACTIVE' } }, select: TEAM_SELECT });
    return uniq(
      rows
        .map(toTeamMember)
        .filter((m) => (queue ? m.queues.includes(queue) : m.queues.some((x) => within.includes(x))))
        .map((m) => m.userId),
    );
  }

  private async addMessage(
    tx: Tx,
    conv: ConversationRow,
    m: { authorType: 'CUSTOMER' | 'AGENT' | 'BOT' | 'SYSTEM'; authorUserId?: string; body: string; internal?: boolean; options?: SupportBotOption[] },
  ) {
    await tx.supportMessage.create({
      data: {
        tenantId: conv.tenantId,
        conversationId: conv.id,
        authorType: m.authorType,
        authorUserId: m.authorUserId ?? null,
        body: m.body,
        internal: m.internal ?? false,
        metadata: (m.options ? { options: m.options } : {}) as unknown as Prisma.InputJsonValue,
      },
    });
  }

  private async lock(tx: Tx, id: string): Promise<ConversationRow> {
    const locked = await tx.$queryRaw<{ id: string }[]>`select id from support_conversations where id = ${id}::uuid for update`;
    if (!locked.length) throw AppError.notFound('Conversa não encontrada.');
    return tx.supportConversation.findUniqueOrThrow({ where: { id } });
  }

  /** Ações do painel: conversa de fila que o usuário não atende é tratada como inexistente. */
  private async lockForAgent(tx: Tx, id: string): Promise<ConversationRow> {
    const conv = await this.lock(tx, id);
    if (!this.handles(await this.access(tx), conv)) throw AppError.notFound('Conversa não encontrada.');
    return conv;
  }

  private async loadDetail(tx: Tx, id: string): Promise<SupportConversationDetail> {
    const auth = currentAuth();
    const access = await this.access(tx);
    const conv = await tx.supportConversation.findUnique({ where: { id } });
    if (!conv || (conv.requesterUserId !== auth.userId && !this.handles(access, conv))) throw AppError.notFound('Conversa não encontrada.');
    const asCustomer = !this.isAgentFor(access, conv);
    const rows = await tx.supportMessage.findMany({
      where: { conversationId: id, ...(asCustomer ? { internal: false } : {}) },
      orderBy: { seq: 'asc' },
      take: 500,
    });
    const users = await tx.user.findMany({ where: { id: { in: uniq(rows.map((r) => r.authorUserId)) } }, select: { id: true, name: true } });
    const names = new Map(users.map((u) => [u.id, u.name]));
    const last = rows.at(-1);
    const [dto] = await this.toDtos(tx, [conv]);
    return {
      ...dto!,
      messages: rows.map((r) => ({
        id: r.id,
        authorType: r.authorType,
        author: r.authorUserId ? { id: r.authorUserId, name: names.get(r.authorUserId) ?? (r.authorType === 'AGENT' ? 'Atendente' : 'Você') } : null,
        body: r.body,
        internal: r.internal,
        options:
          r.authorType === 'BOT' && r.id === last?.id && conv.status === 'BOT'
            ? ((r.metadata as { options?: SupportBotOption[] } | null)?.options ?? null)
            : null,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  }

  private async toDtos(tx: Tx, rows: ConversationRow[]): Promise<SupportConversationDto[]> {
    if (!rows.length) return [];
    const access = await this.access(tx);
    const [users, orgs, orders, previews] = await Promise.all([
      tx.user.findMany({ where: { id: { in: uniq(rows.flatMap((r) => [r.requesterUserId, r.assigneeUserId])) } }, select: { id: true, name: true } }),
      tx.organization.findMany({ where: { id: { in: uniq(rows.map((r) => r.requesterOrgId)) } }, select: { id: true, name: true } }),
      tx.loadingOrder.findMany({ where: { id: { in: uniq(rows.map((r) => r.orderId)) } }, select: { id: true, number: true } }),
      // Última mensagem visível para quem consulta (RLS oculta notas internas do cliente).
      tx.$queryRaw<{ conversation_id: string; body: string }[]>(Prisma.sql`
        select distinct on (conversation_id) conversation_id, body
        from support_messages
        where conversation_id in (${Prisma.join(rows.map((r) => Prisma.sql`${r.id}::uuid`))})
        order by conversation_id, seq desc
      `),
    ]);
    const names = new Map(users.map((u) => [u.id, u.name]));
    const orgNames = new Map(orgs.map((o) => [o.id, o.name]));
    const orderNumbers = new Map(orders.map((o) => [o.id, o.number]));
    const lastBodies = new Map(previews.map((p) => [p.conversation_id, p.body]));
    const now = Date.now();

    return rows.map((r) => ({
      id: r.id,
      number: r.number,
      queue: r.queue,
      status: r.status,
      priority: r.priority,
      subject: r.subject,
      requester: { id: r.requesterUserId, name: names.get(r.requesterUserId) ?? '—', organization: r.requesterOrgId ? (orgNames.get(r.requesterOrgId) ?? null) : null },
      assignee: r.assigneeUserId ? { id: r.assigneeUserId, name: names.get(r.assigneeUserId) ?? 'Atendente' } : null,
      order: r.orderId && orderNumbers.has(r.orderId) ? { id: r.orderId, number: orderNumbers.get(r.orderId)! } : null,
      lastMessageAt: r.lastMessageAt.toISOString(),
      lastMessagePreview: lastBodies.has(r.id) ? preview(lastBodies.get(r.id)!) : null,
      firstResponseAt: r.firstResponseAt?.toISOString() ?? null,
      resolvedAt: r.resolvedAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
      waitingMinutes: r.status === 'WAITING' && r.queuedAt ? Math.floor((now - r.queuedAt.getTime()) / 60_000) : null,
      sla: supportSlaState(r, now),
      allowedTransitions: this.isAgentFor(access, r) ? [...SUPPORT_AGENT_TRANSITIONS[r.status]] : [],
    }));
  }
}

@ApiTags('atendimento')
@Controller('support')
export class SupportController {
  constructor(private readonly support: SupportService) {}

  @Get('conversations')
  @RequirePermission('support.use')
  mine() {
    return this.support.mine();
  }

  @Post('conversations')
  @RequirePermission('support.use')
  start(@Body(new ZodPipe(supportStartSchema)) body: z.output<typeof supportStartSchema>) {
    return this.support.start(body);
  }

  @Get('queue')
  @RequireAnyPermission(...STAFF)
  queue(@Query(new ZodPipe(supportQueueQuery)) q: SupportQueueQuery) {
    return this.support.queue(q);
  }

  @Get('summary')
  @RequireAnyPermission(...STAFF)
  summary(@Query(new ZodPipe(supportSummaryQuery)) q: z.output<typeof supportSummaryQuery>) {
    return this.support.summary(q.queue);
  }

  @Get('analytics')
  @RequireAnyPermission(...STAFF)
  analytics(@Query(new ZodPipe(supportAnalyticsQuery)) q: SupportAnalyticsQuery) {
    return this.support.analytics(q);
  }

  @Get('agents')
  @RequireAnyPermission(...STAFF)
  agents(@Query(new ZodPipe(supportAgentsQuery)) q: SupportAgentsQuery) {
    return this.support.agents(q);
  }

  @Get('team')
  @RequirePermission('support.manage')
  team() {
    return this.support.team();
  }

  @Patch('team/:membershipId')
  @RequirePermission('support.manage')
  updateTeamMember(@Param('membershipId', uuid) membershipId: string, @Body(new ZodPipe(supportTeamUpdateSchema)) body: z.output<typeof supportTeamUpdateSchema>) {
    return this.support.updateTeamMember(membershipId, body.queues);
  }

  @Get('conversations/:id')
  @RequirePermission('support.use')
  detail(@Param('id', uuid) id: string) {
    return this.support.detail(id);
  }

  @Post('conversations/:id/messages')
  @HttpCode(200)
  @RequirePermission('support.use')
  post(@Param('id', uuid) id: string, @Body(new ZodPipe(supportMessageSchema)) body: MessageInput) {
    return this.support.post(id, body);
  }

  @Post('conversations/:id/close')
  @HttpCode(200)
  @RequirePermission('support.use')
  close(@Param('id', uuid) id: string) {
    return this.support.close(id);
  }

  @Post('conversations/:id/assign')
  @HttpCode(200)
  @RequireAnyPermission(...STAFF)
  assign(@Param('id', uuid) id: string, @Body(new ZodPipe(supportAssignSchema)) body: z.output<typeof supportAssignSchema>) {
    return this.support.assign(id, body.assigneeUserId);
  }

  @Post('conversations/:id/transition')
  @HttpCode(200)
  @RequireAnyPermission(...STAFF)
  transition(@Param('id', uuid) id: string, @Body(new ZodPipe(supportTransitionSchema)) body: z.output<typeof supportTransitionSchema>) {
    return this.support.transition(id, body.to);
  }

  /** Corpo vazio quando a transferência tira a conversa das filas do atendente. */
  @Patch('conversations/:id')
  @RequireAnyPermission(...STAFF)
  update(@Param('id', uuid) id: string, @Body(new ZodPipe(supportUpdateSchema)) body: z.output<typeof supportUpdateSchema>) {
    return this.support.update(id, body);
  }
}

@Module({
  controllers: [SupportController],
  providers: [SupportService],
})
export class SupportModule {}
