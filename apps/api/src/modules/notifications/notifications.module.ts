import { Controller, Get, HttpCode, Inject, Injectable, Logger, Module, Param, ParseUUIDPipe, Post, Query, Req, Res, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  isRealtimeDeliverable,
  notificationHref,
  notificationListQuery,
  REALTIME_CHANNEL,
  type NotificationDto,
  type NotificationListQuery,
  type NotificationsPage,
  type RealtimeMessage,
} from '@ordens/contracts';
import type { Request, Response } from 'express';
import { Redis } from 'ioredis';
import { SelfService } from '../../common/decorators.js';
import { ENV, type Env } from '../../config/env.js';
import { AppError } from '../../common/errors.js';
import { currentAuth } from '../../common/request-context.js';
import { ZodPipe } from '../../common/zod.pipe.js';
import { TenantDb } from '../../infra/tenant-db.service.js';

const uuid = new ParseUUIDPipe({ errorHttpStatusCode: 404 });
const HEARTBEAT_MS = 25_000;
/** Conexões são recicladas: a reconexão passa de novo pela autenticação (revogação, logout-all, troca de organização). */
const MAX_STREAM_MS = 10 * 60_000;

@Injectable()
export class NotificationsService {
  constructor(private readonly db: TenantDb) {}

  list(q: NotificationListQuery): Promise<NotificationsPage> {
    return this.db.read(async (tx) => {
      // RLS: somente avisos do próprio usuário no tenant ativo.
      const items = await tx.notification.findMany({
        where: q.unreadOnly ? { readAt: null } : {},
        orderBy: { createdAt: 'desc' },
        take: q.limit,
      });
      const unread = await tx.notification.count({ where: { readAt: null } });
      return {
        unread,
        items: items.map(
          (n): NotificationDto => ({
            id: n.id,
            type: n.type,
            title: n.title,
            body: n.body,
            href: notificationHref(n.data),
            createdAt: n.createdAt.toISOString(),
            readAt: n.readAt?.toISOString() ?? null,
          }),
        ),
      };
    });
  }

  async read(id: string): Promise<void> {
    await this.db.read((tx) => tx.notification.updateMany({ where: { id, readAt: null }, data: { readAt: new Date() } }));
  }

  async readAll(): Promise<void> {
    await this.db.read((tx) => tx.notification.updateMany({ where: { readAt: null }, data: { readAt: new Date() } }));
  }
}

/** Assinante único do canal Redis; distribui mensagens às conexões SSE deste processo. */
@Injectable()
export class RealtimeHub implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Realtime');
  private readonly listeners = new Set<(msg: RealtimeMessage) => void>();
  private subscriber: Redis | null = null;

  constructor(@Inject(ENV) private readonly env: Env) {}

  async onModuleInit() {
    const sub = new Redis(this.env.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: null });
    sub.on('error', (err) => this.logger.warn(`Canal de tempo real indisponível: ${err.message}`));
    sub.on('message', (_channel, raw) => {
      let msg: RealtimeMessage;
      try {
        msg = JSON.parse(raw) as RealtimeMessage;
      } catch {
        return;
      }
      for (const listener of this.listeners) listener(msg);
    });
    this.subscriber = sub;
    try {
      await sub.connect();
      await sub.subscribe(REALTIME_CHANNEL);
    } catch (err) {
      // A API segue funcionando sem tempo real; a interface volta ao polling.
      this.logger.warn(`Não foi possível assinar ${REALTIME_CHANNEL}: ${(err as Error).message}`);
    }
  }

  add(listener: (msg: RealtimeMessage) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async onModuleDestroy() {
    await this.subscriber?.quit().catch(() => undefined);
  }
}

@ApiTags('notificações')
@SelfService()
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(@Query(new ZodPipe(notificationListQuery)) q: NotificationListQuery) {
    return this.notifications.list(q);
  }

  @Post('read-all')
  @HttpCode(204)
  readAll() {
    return this.notifications.readAll();
  }

  @Post(':id/read')
  @HttpCode(204)
  read(@Param('id', uuid) id: string) {
    return this.notifications.read(id);
  }
}

/**
 * SSE por usuário (ADR-004: em produção o ingress roteia /realtime direto para a API).
 * Só trafegam chaves de consulta; os dados continuam vindo da API com RLS.
 */
@ApiTags('tempo real')
@SelfService()
@Controller('realtime')
export class RealtimeController {
  constructor(private readonly hub: RealtimeHub) {}

  @Get('stream')
  stream(@Req() req: Request, @Res() res: Response) {
    const auth = currentAuth();
    const m = auth.membership;
    if (!m) throw AppError.forbidden('Selecione uma organização para continuar.');
    const target = { userId: auth.userId, tenantId: m.tenantId, scope: m.scope, orgIds: m.orgIds };

    res.status(200).set({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();
    res.write('retry: 5000\n\nevent: ready\ndata: {}\n\n');

    const off = this.hub.add((msg) => {
      if (isRealtimeDeliverable(msg, target)) res.write(`event: ${msg.kind}\ndata: ${JSON.stringify({ keys: msg.keys })}\n\n`);
    });
    const heartbeat = setInterval(() => res.write(': ping\n\n'), HEARTBEAT_MS);
    const recycle = setTimeout(() => res.end(), MAX_STREAM_MS);
    req.on('close', () => {
      off();
      clearInterval(heartbeat);
      clearTimeout(recycle);
    });
  }
}

@Module({
  controllers: [NotificationsController, RealtimeController],
  providers: [NotificationsService, RealtimeHub],
})
export class NotificationsModule {}
