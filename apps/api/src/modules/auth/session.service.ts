import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Scope, SessionStage } from '@ordens/contracts';
import { Database, type Tx } from '@ordens/db';
import type { Redis } from 'ioredis';
import { ENV, type Env } from '../../config/env.js';
import { REDIS } from '../../infra/infra.module.js';
import { hmac, randomToken, sha256, toHex } from './crypto.js';

export interface CachedMembership {
  id: string;
  tenantId: string;
  organizationId: string;
  scope: Scope;
  roles: string[];
}

export interface ResolvedSession {
  sessionId: string;
  userId: string;
  userName: string;
  email: string;
  isPlatformAdmin: boolean;
  stage: SessionStage;
  securityVersion: number;
  membership: CachedMembership | null;
  cachedAt: number;
}

const CACHE_TTL_SECONDS = 60;
const VERSION_TTL_SECONDS = 3600;

/** SET somente se o novo valor for maior (versões monotônicas: escritor atrasado nunca rebaixa). */
const MAX_SET = `
local cur = tonumber(redis.call('GET', KEYS[1]) or '0')
local nv = tonumber(ARGV[1])
if nv > cur then redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2]) else redis.call('EXPIRE', KEYS[1], ARGV[2]) end
return math.max(cur, nv)
`;

/**
 * Sessões opacas. PostgreSQL é a autoridade; Redis é cache curto e sinal de revogação.
 * Ver docs/sessions.md e ADR-005.
 */
@Injectable()
export class SessionService {
  private readonly logger = new Logger(SessionService.name);
  private readonly secret: Buffer;
  readonly cookieName: string;
  readonly csrfCookieName = 'ordens_csrf';

  constructor(
    private readonly db: Database,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(ENV) private readonly env: Env,
  ) {
    this.secret = Buffer.from(env.SESSION_SECRET, 'base64');
    this.cookieName = env.COOKIE_SECURE ? '__Host-ordens_sid' : 'ordens_sid';
  }

  get cookieSecure(): boolean {
    return this.env.COOKIE_SECURE;
  }

  get absoluteMaxAgeMs(): number {
    return this.env.SESSION_ABSOLUTE_DAYS * 86_400_000;
  }

  csrfTokenFor(sessionId: string): string {
    return hmac(this.secret, `csrf:${sessionId}`);
  }

  /** Cria sessão dentro da transação do chamador (login, rotação). */
  async create(
    tx: Tx,
    input: {
      userId: string;
      securityVersion: number;
      stage: SessionStage;
      activeMembershipId: string | null;
      ip: string | null;
      userAgent: string | null;
    },
  ): Promise<{ token: string; sessionId: string }> {
    const token = randomToken(32);
    const now = Date.now();
    const pendingTtl = 10 * 60_000;
    const idle = input.stage === 'ACTIVE' ? this.env.SESSION_IDLE_HOURS * 3_600_000 : pendingTtl;
    const absolute = input.stage === 'ACTIVE' ? this.absoluteMaxAgeMs : pendingTtl;
    const session = await tx.session.create({
      data: {
        tokenHash: sha256(token),
        userId: input.userId,
        activeMembershipId: input.activeMembershipId,
        securityVersion: input.securityVersion,
        stage: input.stage,
        ip: input.ip,
        userAgent: input.userAgent?.slice(0, 512) ?? null,
        idleExpiresAt: new Date(now + idle),
        absoluteExpiresAt: new Date(now + absolute),
      },
    });
    return { token, sessionId: session.id };
  }

  async resolve(token: string): Promise<ResolvedSession | null> {
    if (!token || token.length > 128) return null;
    const hash = sha256(token);
    const key = `sess:${toHex(hash)}`;

    const cached = await this.fromCache(key);
    if (cached) return cached;

    const row = await this.db.system((tx) =>
      tx.session.findUnique({
        where: { tokenHash: hash },
        include: { user: { select: { id: true, name: true, email: true, status: true, securityVersion: true, isPlatformAdmin: true } } },
      }),
    );
    const now = new Date();
    if (
      !row ||
      row.revokedAt ||
      row.idleExpiresAt < now ||
      row.absoluteExpiresAt < now ||
      row.user.status !== 'ACTIVE' ||
      row.securityVersion !== row.user.securityVersion
    ) {
      return null;
    }

    let membership: CachedMembership | null = null;
    if (row.activeMembershipId) {
      // Contexto com user_id: as políticas de memberships só expõem as do próprio usuário fora de um tenant.
      const m = await this.db.run(
        { tenantId: null, userId: row.userId, membershipId: null, scope: 'SYSTEM', orgIds: [] },
        (tx) =>
          tx.membership.findFirst({
            where: { id: row.activeMembershipId!, userId: row.userId, status: 'ACTIVE', tenant: { status: 'ACTIVE' } },
            include: { roles: { select: { roleCode: true } } },
          }),
      );
      if (m) {
        membership = {
          id: m.id,
          tenantId: m.tenantId,
          organizationId: m.organizationId,
          scope: m.scope,
          roles: m.roles.map((r) => r.roleCode),
        };
      }
    }

    const resolved: ResolvedSession = {
      sessionId: row.id,
      userId: row.userId,
      userName: row.user.name,
      email: row.user.email,
      isPlatformAdmin: row.user.isPlatformAdmin,
      stage: row.stage,
      securityVersion: row.securityVersion,
      membership,
      cachedAt: Date.now(),
    };

    // Atualiza last_seen/idle no máximo a cada 5 minutos.
    if (now.getTime() - row.lastSeenAt.getTime() > 5 * 60_000 && row.stage === 'ACTIVE') {
      const idleExpiresAt = new Date(Math.min(now.getTime() + this.env.SESSION_IDLE_HOURS * 3_600_000, row.absoluteExpiresAt.getTime()));
      await this.db
        .system((tx) => tx.session.update({ where: { id: row.id }, data: { lastSeenAt: now, idleExpiresAt } }))
        .catch((err: unknown) => this.logger.warn({ err }, 'Falha ao atualizar last_seen'));
    }

    await this.toCache(key, resolved);
    return resolved;
  }

  /** Revoga uma sessão (na transação do chamador) e invalida o cache. */
  async revoke(tx: Tx, sessionId: string, reason: string): Promise<void> {
    await this.safeRedis(() => this.redis.set(`sess-revoked:${sessionId}`, '1', 'EX', CACHE_TTL_SECONDS * 2));
    await tx.session.updateMany({ where: { id: sessionId, revokedAt: null }, data: { revokedAt: new Date(), revokedReason: reason } });
  }

  /**
   * Incrementa users.security_version e revoga todas as sessões do usuário.
   * O sinal no Redis é gravado ANTES do commit (monotônico): caches antigos são rejeitados e caem no PostgreSQL.
   */
  async bumpSecurityVersion(tx: Tx, userId: string, reason: string): Promise<number> {
    const user = await tx.user.update({
      where: { id: userId },
      data: { securityVersion: { increment: 1 } },
      select: { securityVersion: true },
    });
    await this.safeRedis(() => this.redis.eval(MAX_SET, 1, `user-secver:${userId}`, String(user.securityVersion), String(VERSION_TTL_SECONDS)));
    await tx.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date(), revokedReason: reason } });
    return user.securityVersion;
  }

  /** Sinaliza mudança de autorização (papéis/membership) para invalidar caches de sessão do usuário. */
  async signalAuthzChange(userId: string): Promise<void> {
    await this.safeRedis(() => this.redis.eval(MAX_SET, 1, `user-authz:${userId}`, String(Date.now()), String(VERSION_TTL_SECONDS)));
  }

  private async fromCache(key: string): Promise<ResolvedSession | null> {
    try {
      const raw = await this.redis.get(key);
      if (!raw) return null;
      const s = JSON.parse(raw) as ResolvedSession;
      const [secver, authz, revoked] = await this.redis.mget(`user-secver:${s.userId}`, `user-authz:${s.userId}`, `sess-revoked:${s.sessionId}`);
      // Sem sinal de versão conhecido → revalida no PostgreSQL.
      if (secver === null || Number(secver) !== s.securityVersion) return null;
      if (authz !== null && Number(authz) >= s.cachedAt) return null;
      if (revoked !== null) return null;
      return s;
    } catch {
      return null;
    }
  }

  private async toCache(key: string, s: ResolvedSession): Promise<void> {
    await this.safeRedis(async () => {
      await this.redis.eval(MAX_SET, 1, `user-secver:${s.userId}`, String(s.securityVersion), String(VERSION_TTL_SECONDS));
      await this.redis.set(key, JSON.stringify(s), 'EX', CACHE_TTL_SECONDS);
    });
  }

  private async safeRedis(fn: () => Promise<unknown>): Promise<void> {
    try {
      await fn();
    } catch (err) {
      this.logger.error({ err }, 'Redis indisponível — sessões seguem validadas pelo PostgreSQL');
    }
  }
}
