import { Body, Controller, Get, HttpCode, Injectable, Module, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  asksForAgent,
  classifySupportText,
  cursorQuery,
  ErrorCode,
  findOrderNumber,
  SUPPORT_AGENT_TRANSITIONS,
  SUPPORT_BOT_OPTIONS,
  SUPPORT_QUEUE_LABELS,
  SUPPORT_STATUS_LABELS,
  SUPPORT_STATUSES,
  supportAssignSchema,
  supportMessageSchema,
  supportQueueQuery,
  supportStartSchema,
  supportTransitionSchema,
  supportUpdateSchema,
  type CursorPage,
  type LookupOption,
  type Page,
  type SupportBotAction,
  type SupportBotOption,
  type SupportConversationDetail,
  type SupportConversationDto,
  type SupportQueue,
  type SupportQueueQuery,
  type SupportStatus,
  type SupportSummary,
} from '@ordens/contracts';
import { nextSequence, Prisma, type Tx, type UnitOfWorkScope } from '@ordens/db';
import type { z } from 'zod';
import { RequirePermission } from '../../common/decorators.js';
import { AppError } from '../../common/errors.js';
import { currentAuth } from '../../common/request-context.js';
import { ZodPipe } from '../../common/zod.pipe.js';
import { TenantDb } from '../../infra/tenant-db.service.js';
import { oneOf, uniq } from '../fiscal/fiscal.util.js';

type ConversationRow = NonNullable<Awaited<ReturnType<Tx['supportConversation']['findUnique']>>>;
type BotState = { step?: 'CHOOSE_QUEUE' | 'DESCRIBE' | 'DONE'; attempts?: number };
type MessageInput = z.output<typeof supportMessageSchema>;

const uuid = new ParseUUIDPipe({ errorHttpStatusCode: 404 });
const TZ = 'America/Sao_Paulo';
const AGENT_OPTION: SupportBotOption = { action: 'AGENT', label: 'Falar com um atendente', hint: 'Vai direto para a fila de atendimento' };
const BOT_MENU: SupportBotOption[] = [...SUPPORT_BOT_OPTIONS, AGENT_OPTION];
/** Tentativas do assistente sem entender o assunto antes de encaminhar ao Suporte (Q27). */
const MAX_BOT_ATTEMPTS = 2;
const preview = (text: string) => (text.length > 120 ? `${text.slice(0, 117)}…` : text);
const minutes = (v: Prisma.Decimal | number | null) => (v === null ? null : Math.round(Number(v)));

@Injectable()
export class SupportService {
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
      const agent = this.isAgentFor(conv);
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
      // Botão do assistente vira mensagem do cliente com o rótulo escolhido (o histórico mostra a escolha).
      const quickLabel = !text && input.quickReply ? BOT_MENU.find((o) => o.action === input.quickReply)?.label : undefined;
      if (text || quickLabel) await this.addMessage(tx, conv, { authorType: 'CUSTOMER', authorUserId: auth.userId, body: text || quickLabel! });

      if (conv.status === 'BOT') {
        await this.runBot(scope, conv, text, input.quickReply, auth.userName.split(' ')[0] ?? '');
        return this.loadDetail(tx, id);
      }
      if (!text) throw AppError.validation({ fields: { body: ['Escreva uma mensagem'] } });

      const now = new Date();
      const reopen = conv.status === 'RESOLVED';
      await tx.supportConversation.update({
        where: { id },
        data: {
          lastMessageAt: now,
          ...(reopen ? { status: 'WAITING', queuedAt: now, resolvedAt: null } : conv.status === 'PENDING_CUSTOMER' ? { status: 'OPEN' } : {}),
        },
      });
      if (reopen) {
        await this.addMessage(tx, conv, { authorType: 'BOT', body: 'Conversa reaberta. Um atendente vai retomar por aqui.' });
        await audit({ entityType: 'support_conversation', entityId: id, action: 'support.status_changed', before: { status: 'RESOLVED' }, after: { status: 'WAITING', reason: 'mensagem do cliente' } });
      }
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
      const status = oneOf(SUPPORT_STATUSES, q.status);
      const where: Prisma.SupportConversationWhereInput = {
        status: status?.length ? { in: status } : { in: ['WAITING', 'OPEN', 'PENDING_CUSTOMER'] },
        ...(q.queue ? { queue: q.queue } : {}),
        ...(q.priority ? { priority: q.priority } : {}),
        ...(q.assignee === 'me' ? { assigneeUserId: auth.userId } : q.assignee === 'none' ? { assigneeUserId: null } : q.assignee ? { assigneeUserId: q.assignee } : {}),
        ...(q.q ? { OR: [{ number: { contains: q.q, mode: 'insensitive' } }, { subject: { contains: q.q, mode: 'insensitive' } }] } : {}),
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

  summary(): Promise<SupportSummary> {
    const auth = currentAuth();
    return this.db.read(async (tx) => {
      const [r] = await tx.$queryRaw<Record<string, bigint | Prisma.Decimal | number | null>[]>(Prisma.sql`
        select
          count(*) filter (where status = 'WAITING' and queue = 'BILLING') as waiting_billing,
          count(*) filter (where status = 'WAITING' and queue = 'SUPPORT') as waiting_support,
          count(*) filter (where status = 'OPEN') as open,
          count(*) filter (where status = 'PENDING_CUSTOMER') as pending_customer,
          count(*) filter (where status in ('WAITING', 'OPEN', 'PENDING_CUSTOMER') and assignee_user_id is null) as unassigned,
          count(*) filter (where status in ('WAITING', 'OPEN', 'PENDING_CUSTOMER') and assignee_user_id = ${auth.userId}::uuid) as mine,
          count(*) filter (where resolved_at >= (date_trunc('day', now() at time zone ${TZ}) at time zone ${TZ})) as resolved_today,
          extract(epoch from now() - min(queued_at) filter (where status = 'WAITING')) / 60 as oldest_waiting,
          avg(extract(epoch from first_response_at - queued_at) / 60) filter (where first_response_at is not null and queued_at >= now() - interval '7 days') as avg_first_response
        from support_conversations
      `);
      const n = (k: string) => Number(r?.[k] ?? 0);
      return {
        waiting: { BILLING: n('waiting_billing'), SUPPORT: n('waiting_support') },
        open: n('open'),
        pendingCustomer: n('pending_customer'),
        unassigned: n('unassigned'),
        mine: n('mine'),
        resolvedToday: n('resolved_today'),
        oldestWaitingMinutes: minutes((r?.oldest_waiting ?? null) as Prisma.Decimal | null),
        avgFirstResponseMinutes: minutes((r?.avg_first_response ?? null) as Prisma.Decimal | null),
      };
    });
  }

  agents(q: z.output<typeof cursorQuery>): Promise<CursorPage<LookupOption>> {
    return this.db.read(async (tx) => {
      const memberships = await tx.membership.findMany({ where: { scope: 'MATRIZ', status: 'ACTIVE' }, select: { userId: true } });
      const users = await tx.user.findMany({
        where: {
          id: { in: uniq(memberships.map((m) => m.userId)) },
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
      const conv = await this.lock(tx, id);
      if (conv.status === 'CLOSED') throw AppError.domain(ErrorCode.INVALID_TRANSITION, 'Conversa encerrada.');
      let name: string | null = null;
      if (assigneeUserId) {
        const member = await tx.membership.findFirst({ where: { userId: assigneeUserId, scope: 'MATRIZ', status: 'ACTIVE' }, select: { userId: true } });
        if (!member) throw AppError.validation({ fields: { assigneeUserId: ['Selecione um atendente da Matriz'] } });
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
      const conv = await this.lock(tx, id);
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

  update(id: string, input: z.output<typeof supportUpdateSchema>): Promise<SupportConversationDetail> {
    return this.db.write(async ({ tx, audit, outbox }) => {
      const conv = await this.lock(tx, id);
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
      return this.loadDetail(tx, id);
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

  private get canManage() {
    const auth = currentAuth();
    return auth.membership?.scope === 'MATRIZ' && auth.permissions.has('support.manage');
  }

  /** Atendente: Matriz com support.manage agindo em conversa aberta por outra pessoa. */
  private isAgentFor(conv: { requesterUserId: string }) {
    return this.canManage && conv.requesterUserId !== currentAuth().userId;
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

  private async loadDetail(tx: Tx, id: string): Promise<SupportConversationDetail> {
    const auth = currentAuth();
    const conv = await tx.supportConversation.findUnique({ where: { id } });
    if (!conv || (conv.requesterUserId !== auth.userId && !this.canManage)) throw AppError.notFound('Conversa não encontrada.');
    const asCustomer = !this.isAgentFor(conv);
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
      allowedTransitions: this.isAgentFor(r) ? [...SUPPORT_AGENT_TRANSITIONS[r.status]] : [],
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
  @RequirePermission('support.manage')
  queue(@Query(new ZodPipe(supportQueueQuery)) q: SupportQueueQuery) {
    return this.support.queue(q);
  }

  @Get('summary')
  @RequirePermission('support.manage')
  summary() {
    return this.support.summary();
  }

  @Get('agents')
  @RequirePermission('support.manage')
  agents(@Query(new ZodPipe(cursorQuery)) q: z.output<typeof cursorQuery>) {
    return this.support.agents(q);
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
  @RequirePermission('support.manage')
  assign(@Param('id', uuid) id: string, @Body(new ZodPipe(supportAssignSchema)) body: z.output<typeof supportAssignSchema>) {
    return this.support.assign(id, body.assigneeUserId);
  }

  @Post('conversations/:id/transition')
  @HttpCode(200)
  @RequirePermission('support.manage')
  transition(@Param('id', uuid) id: string, @Body(new ZodPipe(supportTransitionSchema)) body: z.output<typeof supportTransitionSchema>) {
    return this.support.transition(id, body.to);
  }

  @Patch('conversations/:id')
  @RequirePermission('support.manage')
  update(@Param('id', uuid) id: string, @Body(new ZodPipe(supportUpdateSchema)) body: z.output<typeof supportUpdateSchema>) {
    return this.support.update(id, body);
  }
}

@Module({
  controllers: [SupportController],
  providers: [SupportService],
})
export class SupportModule {}
