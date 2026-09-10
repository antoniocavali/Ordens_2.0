import { Inject, Injectable } from '@nestjs/common';
import {
  ErrorCode,
  permissionsForRoles,
  type LoginHistoryItem,
  type MeResponse,
  type MembershipSummary,
  type SessionInfo,
  type SessionStage,
  type Theme,
} from '@ordens/contracts';
import {
  Database,
  DUMMY_PASSWORD_HASH,
  hashPassword,
  needsRehash,
  verifyPassword,
  writeAudit,
  writeOutbox,
  type ActorMeta,
  type DbContext,
  type Tx,
} from '@ordens/db';
import { ENV, type Env } from '../../config/env.js';
import { AppError } from '../../common/errors.js';
import { actorMeta, currentAuth, currentRequest, type AuthState } from '../../common/request-context.js';
import { encrypt, randomToken, sha256, toBase64, type Bytes } from './crypto.js';
import { LockoutService } from './lockout.service.js';
import { SessionService } from './session.service.js';
import { TwoFactorService } from './two-factor.service.js';

export interface IssuedSession {
  token: string;
  sessionId: string;
  stage: SessionStage;
}

type MembershipRow = Awaited<ReturnType<AuthService['loadMemberships']>>[number];

const systemCtx = (userId: string | null, tenantId: string | null = null): DbContext => ({
  tenantId,
  userId,
  membershipId: null,
  scope: 'SYSTEM',
  orgIds: [],
});

@Injectable()
export class AuthService {
  private readonly outboxKey: Bytes;

  constructor(
    private readonly db: Database,
    private readonly sessions: SessionService,
    private readonly lockout: LockoutService,
    private readonly twoFactor: TwoFactorService,
    @Inject(ENV) env: Env,
  ) {
    this.outboxKey = sha256(`outbox:${env.SESSION_SECRET}`);
  }

  // ───────────────────────────── Login ─────────────────────────────

  async login(email: string, password: string): Promise<IssuedSession> {
    const req = currentRequest();
    const subject = `login:${email}`;
    await this.lockout.assertAllowed(subject, req.ip);

    const user = await this.db.system((tx) => tx.user.findUnique({ where: { email } }));
    const ok = await verifyPassword(user?.passwordHash ?? DUMMY_PASSWORD_HASH, password);

    if (!user || !ok || user.status !== 'ACTIVE') {
      const lockedFor = await this.lockout.registerFailure(subject, req.ip);
      await this.db.system(async (tx) => {
        await tx.loginAttempt.create({
          data: {
            userId: user?.id ?? null,
            email,
            result: user && ok ? 'INACTIVE' : lockedFor > 0 ? 'LOCKED' : 'INVALID_CREDENTIALS',
            ip: req.ip,
            userAgent: req.userAgent?.slice(0, 512),
          },
        });
        if (user) {
          await tx.user.update({
            where: { id: user.id },
            data: {
              failedLoginCount: { increment: 1 },
              lockedUntil: lockedFor > 0 ? new Date(Date.now() + lockedFor * 1000) : undefined,
            },
          });
        }
        await writeAudit(tx, systemCtx(null), this.meta(user?.id ?? null), {
          entityType: 'user',
          entityId: user?.id ?? null,
          action: lockedFor > 0 ? 'auth.locked' : 'auth.login.failed',
          metadata: { email, lockedForSeconds: lockedFor || undefined },
        });
      });
      throw new AppError(ErrorCode.INVALID_CREDENTIALS, 401, 'E-mail ou senha incorretos.');
    }

    await this.lockout.reset(subject);
    const memberships = await this.loadMemberships(user.id);
    const preferred = await this.preferredMembership(user.id, memberships);
    const twoFactorEnabled = await this.twoFactor.isEnabled(user.id);
    const stage = this.stageFor(twoFactorEnabled, preferred);

    const rehash = needsRehash(user.passwordHash!) ? await hashPassword(password) : null;

    return this.db.system(async (tx) => {
      const issued = await this.sessions.create(tx, {
        userId: user.id,
        securityVersion: user.securityVersion,
        stage,
        activeMembershipId: preferred?.id ?? null,
        ip: req.ip,
        userAgent: req.userAgent,
      });
      await tx.user.update({
        where: { id: user.id },
        data: {
          failedLoginCount: 0,
          lockedUntil: null,
          ...(stage === 'ACTIVE' ? { lastLoginAt: new Date() } : {}),
          ...(rehash ? { passwordHash: rehash } : {}),
        },
      });
      await tx.loginAttempt.create({
        data: { userId: user.id, email, result: 'SUCCESS', ip: req.ip, userAgent: req.userAgent?.slice(0, 512) },
      });
      await writeAudit(tx, systemCtx(user.id, preferred?.tenantId ?? null), { ...this.meta(user.id), sessionId: issued.sessionId }, {
        entityType: 'user',
        entityId: user.id,
        action: stage === 'ACTIVE' ? 'auth.login.succeeded' : 'auth.login.password_verified',
        metadata: { stage, membershipId: preferred?.id },
      });
      return { ...issued, stage };
    });
  }

  /** Conclui login com TOTP ou recovery code; rotaciona a sessão (anti session fixation). */
  async verifySecondFactor(code: string): Promise<IssuedSession> {
    const auth = currentAuth();
    const req = currentRequest();
    const subject = `2fa:${auth.userId}`;
    await this.lockout.assertAllowed(subject, req.ip);

    const method = await this.twoFactor.verifyLoginCode(auth.userId, code);
    if (!method) {
      const lockedFor = await this.lockout.registerFailure(subject, req.ip);
      await this.db.system(async (tx) => {
        await tx.loginAttempt.create({
          data: { userId: auth.userId, email: auth.email, result: 'TWO_FACTOR_FAILED', ip: req.ip, userAgent: req.userAgent?.slice(0, 512) },
        });
        await writeAudit(tx, systemCtx(auth.userId), actorMeta(req), {
          entityType: 'user',
          entityId: auth.userId,
          action: 'auth.2fa.failed',
          metadata: { lockedForSeconds: lockedFor || undefined },
        });
        if (lockedFor > 0) await this.sessions.revoke(tx, auth.sessionId, 'two_factor_lockout');
      });
      throw new AppError(ErrorCode.TWO_FACTOR_INVALID, 401, 'Código inválido ou expirado.');
    }

    await this.lockout.reset(subject);
    return this.rotate(auth, 'ACTIVE', auth.membership?.id ?? null, async (tx, sessionId) => {
      await tx.user.update({ where: { id: auth.userId }, data: { lastLoginAt: new Date() } });
      await tx.loginAttempt.create({
        data: { userId: auth.userId, email: auth.email, result: 'TWO_FACTOR_SUCCESS', ip: req.ip, userAgent: req.userAgent?.slice(0, 512) },
      });
      await writeAudit(tx, systemCtx(auth.userId, auth.membership?.tenantId), { ...actorMeta(req), sessionId }, {
        entityType: 'user',
        entityId: auth.userId,
        action: method === 'RECOVERY' ? 'auth.2fa.recovery_code_used' : 'auth.2fa.verified',
      });
      await writeAudit(tx, systemCtx(auth.userId, auth.membership?.tenantId), { ...actorMeta(req), sessionId }, {
        entityType: 'user',
        entityId: auth.userId,
        action: 'auth.login.succeeded',
      });
    });
  }

  /** Após ativar 2FA em sessão PENDING_2FA_SETUP, a sessão é promovida (rotacionada). */
  async promoteAfterSetup(auth: AuthState): Promise<IssuedSession | null> {
    if (auth.stage !== 'PENDING_2FA_SETUP') return null;
    return this.rotate(auth, 'ACTIVE', auth.membership?.id ?? null, async (tx) => {
      await tx.user.update({ where: { id: auth.userId }, data: { lastLoginAt: new Date() } });
    });
  }

  // ─────────────────────────── Contexto ───────────────────────────

  async switchContext(membershipId: string): Promise<IssuedSession> {
    const auth = currentAuth();
    const memberships = await this.loadMemberships(auth.userId);
    const target = memberships.find((m) => m.id === membershipId);
    if (!target) throw AppError.notFound('Organização não encontrada.');

    const twoFactorEnabled = await this.twoFactor.isEnabled(auth.userId);
    const stage = this.stageFor(twoFactorEnabled, target, true);

    return this.rotate(auth, stage, target.id, async (tx, sessionId) => {
      await this.rememberMembership(tx, auth.userId, target.id);
      await writeAudit(tx, systemCtx(auth.userId, target.tenantId), { ...actorMeta(), sessionId }, {
        entityType: 'membership',
        entityId: target.id,
        action: 'auth.context.switched',
        metadata: { from: auth.membership?.id ?? null, to: target.id },
      });
    });
  }

  // ─────────────────────────── Sessões ───────────────────────────

  async logout(): Promise<void> {
    const auth = currentAuth();
    await this.db.system(async (tx) => {
      await this.sessions.revoke(tx, auth.sessionId, 'logout');
      await writeAudit(tx, systemCtx(auth.userId, auth.membership?.tenantId), actorMeta(), {
        entityType: 'user',
        entityId: auth.userId,
        action: 'auth.logout',
      });
    });
  }

  async logoutAll(): Promise<void> {
    const auth = currentAuth();
    await this.db.system(async (tx) => {
      const version = await this.sessions.bumpSecurityVersion(tx, auth.userId, 'logout_all');
      await writeAudit(tx, systemCtx(auth.userId, auth.membership?.tenantId), actorMeta(), {
        entityType: 'user',
        entityId: auth.userId,
        action: 'auth.logout_all',
        metadata: { securityVersion: version },
      });
    });
  }

  async listSessions(): Promise<SessionInfo[]> {
    const auth = currentAuth();
    const rows = await this.db.system((tx) =>
      tx.session.findMany({
        where: { userId: auth.userId, revokedAt: null, absoluteExpiresAt: { gt: new Date() }, idleExpiresAt: { gt: new Date() } },
        orderBy: { lastSeenAt: 'desc' },
        take: 50,
      }),
    );
    return rows.map((s) => ({
      id: s.id,
      current: s.id === auth.sessionId,
      ip: s.ip,
      userAgent: s.userAgent,
      createdAt: s.createdAt.toISOString(),
      lastSeenAt: s.lastSeenAt.toISOString(),
    }));
  }

  async revokeSession(sessionId: string): Promise<void> {
    const auth = currentAuth();
    await this.db.system(async (tx) => {
      const s = await tx.session.findFirst({ where: { id: sessionId, userId: auth.userId, revokedAt: null } });
      if (!s) throw AppError.notFound('Sessão não encontrada.');
      await this.sessions.revoke(tx, s.id, 'revoked_by_user');
      await writeAudit(tx, systemCtx(auth.userId, auth.membership?.tenantId), actorMeta(), {
        entityType: 'session',
        entityId: s.id,
        action: 'auth.session.revoked',
      });
    });
  }

  async loginHistory(): Promise<LoginHistoryItem[]> {
    const auth = currentAuth();
    const rows = await this.db.system((tx) =>
      tx.loginAttempt.findMany({ where: { userId: auth.userId }, orderBy: { createdAt: 'desc' }, take: 50 }),
    );
    return rows.map((r) => ({ id: r.id, result: r.result, ip: r.ip, userAgent: r.userAgent, createdAt: r.createdAt.toISOString() }));
  }

  // ─────────────────────────── Senha ───────────────────────────

  async forgotPassword(email: string): Promise<void> {
    const req = currentRequest();
    const subject = `forgot:${email}`;
    await this.lockout.assertAllowed(subject, req.ip);
    await this.lockout.registerFailure(subject, null); // limita solicitações repetidas

    const user = await this.db.system((tx) => tx.user.findUnique({ where: { email } }));
    if (!user || user.status !== 'ACTIVE') return; // resposta idêntica

    const token = randomToken(32);
    await this.db.system(async (tx) => {
      await tx.passwordResetToken.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: new Date() } });
      await tx.passwordResetToken.create({
        data: { userId: user.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + 30 * 60_000) },
      });
      await writeAudit(tx, systemCtx(user.id), this.meta(user.id), {
        entityType: 'user',
        entityId: user.id,
        action: 'auth.password.reset_requested',
      });
      // Token cifrado no payload: o worker decifra para montar o link; nunca em texto claro no banco.
      await writeOutbox(tx, systemCtx(user.id), this.meta(user.id), {
        type: 'auth.password_reset_requested',
        aggregateType: 'user',
        aggregateId: user.id,
        payload: { email: user.email, name: user.name, tokenEnc: toBase64(encrypt(this.outboxKey, token)) },
      });
    });
  }

  async resetPassword(token: string, newPassword: string): Promise<void> {
    const hash = sha256(token);
    const passwordHash = await hashPassword(newPassword);
    await this.db.system(async (tx) => {
      const row = await tx.passwordResetToken.findUnique({ where: { tokenHash: hash } });
      if (!row || row.usedAt || row.expiresAt < new Date()) {
        throw AppError.domain(ErrorCode.VALIDATION_FAILED, 'Link de redefinição inválido ou expirado. Solicite um novo.');
      }
      await tx.passwordResetToken.update({ where: { id: row.id }, data: { usedAt: new Date() } });
      await tx.user.update({ where: { id: row.userId }, data: { passwordHash, failedLoginCount: 0, lockedUntil: null } });
      await this.sessions.bumpSecurityVersion(tx, row.userId, 'password_reset');
      await writeAudit(tx, systemCtx(row.userId), this.meta(row.userId), {
        entityType: 'user',
        entityId: row.userId,
        action: 'auth.password.reset',
      });
    });
  }

  async changePassword(currentPassword: string, newPassword: string, code?: string): Promise<IssuedSession> {
    const auth = currentAuth();
    const user = await this.db.system((tx) => tx.user.findUniqueOrThrow({ where: { id: auth.userId } }));
    if (!(await verifyPassword(user.passwordHash ?? DUMMY_PASSWORD_HASH, currentPassword))) {
      throw AppError.domain(ErrorCode.INVALID_CREDENTIALS, 'Senha atual incorreta.');
    }
    if (await this.twoFactor.isEnabled(auth.userId)) {
      if (!code || !(await this.twoFactor.verifyLoginCode(auth.userId, code))) {
        throw AppError.domain(ErrorCode.TWO_FACTOR_INVALID, 'Código de verificação inválido.');
      }
    }
    const passwordHash = await hashPassword(newPassword);
    const req = currentRequest();

    return this.db.system(async (tx) => {
      await tx.user.update({ where: { id: auth.userId }, data: { passwordHash } });
      const version = await this.sessions.bumpSecurityVersion(tx, auth.userId, 'password_changed');
      const issued = await this.sessions.create(tx, {
        userId: auth.userId,
        securityVersion: version,
        stage: 'ACTIVE',
        activeMembershipId: auth.membership?.id ?? null,
        ip: req.ip,
        userAgent: req.userAgent,
      });
      await writeAudit(tx, systemCtx(auth.userId, auth.membership?.tenantId), { ...actorMeta(req), sessionId: issued.sessionId }, {
        entityType: 'user',
        entityId: auth.userId,
        action: 'auth.password.changed',
      });
      return { ...issued, stage: 'ACTIVE' as const };
    });
  }

  // ─────────────────────────── /me ───────────────────────────

  async me(): Promise<MeResponse> {
    const auth = currentAuth();
    const [memberships, prefs, twoFactorEnabled] = await Promise.all([
      this.loadMemberships(auth.userId),
      this.db.system((tx) => tx.userPreference.findUnique({ where: { userId: auth.userId } })),
      this.twoFactor.isEnabled(auth.userId),
    ]);
    const summaries = memberships.map(toSummary);
    const active = summaries.find((m) => m.id === auth.membership?.id) ?? null;
    return {
      user: {
        id: auth.userId,
        name: auth.userName,
        email: auth.email,
        twoFactorEnabled,
        theme: (prefs?.theme as Theme) ?? 'system',
        sidebarCollapsed: prefs?.sidebarCollapsed ?? false,
      },
      stage: auth.stage,
      activeMembership: active,
      memberships: summaries,
      permissions: active ? [...permissionsForRoles(active.roles)] : [],
      csrfToken: this.sessions.csrfTokenFor(auth.sessionId),
    };
  }

  // ─────────────────────────── Internos ───────────────────────────

  async loadMemberships(userId: string) {
    return this.db.run(systemCtx(userId), (tx) =>
      tx.membership.findMany({
        where: { userId, status: 'ACTIVE', tenant: { status: 'ACTIVE' }, organization: { status: 'ACTIVE' } },
        include: {
          tenant: { select: { id: true, name: true, slug: true, require2fa: true, require2faRoles: true } },
          organization: { select: { id: true, name: true, kind: true } },
          roles: { select: { roleCode: true } },
        },
        orderBy: [{ tenant: { name: 'asc' } }, { organization: { name: 'asc' } }],
      }),
    );
  }

  private async preferredMembership(userId: string, memberships: MembershipRow[]): Promise<MembershipRow | null> {
    if (!memberships.length) return null;
    const prefs = await this.db.system((tx) => tx.userPreference.findUnique({ where: { userId } }));
    const lastId = (prefs?.data as { lastMembershipId?: string } | null)?.lastMembershipId;
    return memberships.find((m) => m.id === lastId) ?? memberships.find((m) => m.scope === 'MATRIZ') ?? memberships[0]!;
  }

  private stageFor(twoFactorEnabled: boolean, membership: MembershipRow | null | undefined, alreadyVerified = false): SessionStage {
    if (twoFactorEnabled) return alreadyVerified ? 'ACTIVE' : 'PENDING_2FA';
    if (!membership) return 'ACTIVE';
    const roles = membership.roles.map((r) => r.roleCode);
    const required = membership.tenant.require2fa || roles.some((r) => membership.tenant.require2faRoles.includes(r));
    return required ? 'PENDING_2FA_SETUP' : 'ACTIVE';
  }

  private async rememberMembership(tx: Tx, userId: string, membershipId: string) {
    const prefs = await tx.userPreference.findUnique({ where: { userId } });
    const data = { ...((prefs?.data as Record<string, unknown>) ?? {}), lastMembershipId: membershipId };
    await tx.userPreference.upsert({ where: { userId }, create: { userId, data }, update: { data } });
  }

  private async rotate(
    auth: AuthState,
    stage: SessionStage,
    membershipId: string | null,
    extra: (tx: Tx, newSessionId: string) => Promise<void>,
  ): Promise<IssuedSession> {
    const req = currentRequest();
    return this.db.system(async (tx) => {
      await this.sessions.revoke(tx, auth.sessionId, 'rotated');
      const issued = await this.sessions.create(tx, {
        userId: auth.userId,
        securityVersion: auth.securityVersion,
        stage,
        activeMembershipId: membershipId,
        ip: req.ip,
        userAgent: req.userAgent,
      });
      await extra(tx, issued.sessionId);
      return { ...issued, stage };
    });
  }

  private meta(userId: string | null): ActorMeta {
    return { ...actorMeta(currentRequest()), actorUserId: userId };
  }
}

function toSummary(m: MembershipRow): MembershipSummary {
  return {
    id: m.id,
    tenant: { id: m.tenant.id, name: m.tenant.name, slug: m.tenant.slug },
    organization: { id: m.organization.id, name: m.organization.name, kind: m.organization.kind },
    scope: m.scope,
    roles: m.roles.map((r) => r.roleCode),
  };
}
