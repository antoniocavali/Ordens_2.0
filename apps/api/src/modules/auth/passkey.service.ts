import { Inject, Injectable } from '@nestjs/common';
import { ErrorCode, PASSKEY_MAX_PER_USER, type PasskeyDto } from '@ordens/contracts';
import { Database, DUMMY_PASSWORD_HASH, verifyPassword, writeAudit, type DbContext } from '@ordens/db';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import type { Redis } from 'ioredis';
import { ENV, type Env } from '../../config/env.js';
import { AppError } from '../../common/errors.js';
import { actorMeta, currentAuth, currentRequest } from '../../common/request-context.js';
import { REDIS } from '../../infra/infra.module.js';
import { AuthService, type IssuedSession } from './auth.service.js';
import { randomToken } from './crypto.js';
import { LockoutService } from './lockout.service.js';

/** Desafios valem 5 minutos e são de uso único (GETDEL). */
const CHALLENGE_TTL_S = 300;
const RP_NAME = 'Ordens TMS';

const selfCtx = (userId: string | null, tenantId: string | null = null): DbContext => ({
  tenantId,
  userId,
  membershipId: null,
  scope: 'SYSTEM',
  orgIds: [],
});

const toB64url = (b: Uint8Array) => Buffer.from(b).toString('base64url');
const fromB64url = (s: string) => new Uint8Array(Buffer.from(s, 'base64url'));

/**
 * Passkeys (WebAuthn): login sem senha, resistente a phishing. Exige verificação do usuário no
 * aparelho (biometria/PIN), então vale como segundo fator: dispensa o código TOTP e satisfaz a
 * política de 2FA obrigatória.
 */
@Injectable()
export class PasskeyService {
  private readonly rpID: string;
  private readonly origin: string;

  constructor(
    private readonly db: Database,
    private readonly auth: AuthService,
    private readonly lockout: LockoutService,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(ENV) env: Env,
  ) {
    const url = new URL(env.WEB_ORIGIN);
    this.rpID = url.hostname;
    this.origin = url.origin;
  }

  // ─────────────────────────── Gestão ───────────────────────────

  async list(): Promise<PasskeyDto[]> {
    const { userId } = currentAuth();
    const rows = await this.db.run(selfCtx(userId), (tx) => tx.webauthnCredential.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } }));
    return rows.map((c) => ({ id: c.id, name: c.name, backedUp: c.backedUp, createdAt: c.createdAt.toISOString(), lastUsedAt: c.lastUsedAt?.toISOString() ?? null }));
  }

  async registrationOptions(password: string) {
    const auth = currentAuth();
    const req = currentRequest();
    const subject = `passkey-register:${auth.userId}`;
    await this.lockout.assertAllowed(subject, req.ip);
    const user = await this.db.system((tx) => tx.user.findUniqueOrThrow({ where: { id: auth.userId }, select: { passwordHash: true } }));
    if (!(await verifyPassword(user.passwordHash ?? DUMMY_PASSWORD_HASH, password))) {
      await this.lockout.registerFailure(subject, req.ip);
      throw AppError.domain(ErrorCode.INVALID_CREDENTIALS, 'Senha incorreta.');
    }
    await this.lockout.reset(subject);

    const existing = await this.db.run(selfCtx(auth.userId), (tx) =>
      tx.webauthnCredential.findMany({ where: { userId: auth.userId }, select: { credentialId: true, transports: true } }),
    );
    if (existing.length >= PASSKEY_MAX_PER_USER) {
      throw AppError.conflict(`Limite de ${PASSKEY_MAX_PER_USER} passkeys atingido. Remova uma antes de cadastrar outra.`);
    }
    const options = await generateRegistrationOptions({
      rpName: RP_NAME,
      rpID: this.rpID,
      userName: auth.email,
      userDisplayName: auth.userName,
      userID: new TextEncoder().encode(auth.userId),
      attestationType: 'none',
      excludeCredentials: existing.map((c) => ({ id: toB64url(c.credentialId), transports: c.transports })),
      // Passkey descoberta (login sem digitar e-mail) com verificação obrigatória no aparelho.
      authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
    });
    await this.redis.set(`webauthn:reg:${auth.sessionId}`, options.challenge, 'EX', CHALLENGE_TTL_S);
    return options;
  }

  async register(name: string, response: RegistrationResponseJSON): Promise<PasskeyDto> {
    const auth = currentAuth();
    const challenge = await this.redis.getdel(`webauthn:reg:${auth.sessionId}`);
    if (!challenge) throw AppError.domain(ErrorCode.PASSKEY_INVALID, 'O cadastro expirou. Comece de novo.');
    const result = await verifyRegistrationResponse({
      response,
      expectedChallenge: challenge,
      expectedOrigin: this.origin,
      expectedRPID: this.rpID,
      requireUserVerification: true,
    }).catch(() => null);
    if (!result?.verified) throw AppError.domain(ErrorCode.PASSKEY_INVALID, 'Não foi possível confirmar a passkey. Tente de novo.');

    const { credential, credentialBackedUp } = result.registrationInfo;
    const tenantId = auth.membership?.tenantId ?? null;
    const row = await this.db.run(selfCtx(auth.userId, tenantId), async (tx) => {
      const credentialId = Buffer.from(fromB64url(credential.id));
      if (await tx.webauthnCredential.findUnique({ where: { credentialId }, select: { id: true } })) {
        throw AppError.conflict('Esta passkey já está cadastrada.');
      }
      const created = await tx.webauthnCredential.create({
        data: {
          userId: auth.userId,
          credentialId,
          publicKey: Buffer.from(credential.publicKey),
          signCount: BigInt(credential.counter),
          transports: credential.transports ?? [],
          backedUp: credentialBackedUp,
          name,
        },
      });
      await writeAudit(tx, selfCtx(auth.userId, tenantId), actorMeta(), {
        entityType: 'webauthn_credential',
        entityId: created.id,
        action: 'auth.passkey.added',
        after: { name, backedUp: credentialBackedUp },
      });
      return created;
    });
    return { id: row.id, name: row.name, backedUp: row.backedUp, createdAt: row.createdAt.toISOString(), lastUsedAt: null };
  }

  async rename(id: string, name: string): Promise<void> {
    const auth = currentAuth();
    const tenantId = auth.membership?.tenantId ?? null;
    await this.db.run(selfCtx(auth.userId, tenantId), async (tx) => {
      const cred = await tx.webauthnCredential.findFirst({ where: { id, userId: auth.userId } });
      if (!cred) throw AppError.notFound('Passkey não encontrada.');
      await tx.webauthnCredential.update({ where: { id }, data: { name } });
      await writeAudit(tx, selfCtx(auth.userId, tenantId), actorMeta(), {
        entityType: 'webauthn_credential',
        entityId: id,
        action: 'auth.passkey.renamed',
        before: { name: cred.name },
        after: { name },
      });
    });
  }

  async remove(id: string): Promise<void> {
    const auth = currentAuth();
    const tenantId = auth.membership?.tenantId ?? null;
    await this.db.run(selfCtx(auth.userId, tenantId), async (tx) => {
      const cred = await tx.webauthnCredential.findFirst({ where: { id, userId: auth.userId } });
      if (!cred) throw AppError.notFound('Passkey não encontrada.');
      await tx.webauthnCredential.delete({ where: { id } });
      await writeAudit(tx, selfCtx(auth.userId, tenantId), actorMeta(), {
        entityType: 'webauthn_credential',
        entityId: id,
        action: 'auth.passkey.removed',
        before: { name: cred.name },
      });
    });
  }

  // ─────────────────────────── Login ───────────────────────────

  async loginOptions() {
    const options = await generateAuthenticationOptions({ rpID: this.rpID, userVerification: 'required' });
    const challengeId = randomToken(24);
    await this.redis.set(`webauthn:auth:${challengeId}`, options.challenge, 'EX', CHALLENGE_TTL_S);
    return { challengeId, options };
  }

  async login(challengeId: string, response: AuthenticationResponseJSON): Promise<IssuedSession> {
    const req = currentRequest();
    const subject = `passkey:${req.ip ?? 'unknown'}`;
    await this.lockout.assertAllowed(subject, req.ip);

    const challenge = await this.redis.getdel(`webauthn:auth:${challengeId}`);
    const cred = await this.db.system((tx) =>
      tx.webauthnCredential.findUnique({
        where: { credentialId: Buffer.from(fromB64url(response.id)) },
        include: { user: { select: { id: true, email: true, status: true } } },
      }),
    );

    let verification: Awaited<ReturnType<typeof verifyAuthenticationResponse>> | null = null;
    if (challenge && cred) {
      verification = await verifyAuthenticationResponse({
        response,
        expectedChallenge: challenge,
        expectedOrigin: this.origin,
        expectedRPID: this.rpID,
        requireUserVerification: true,
        credential: { id: toB64url(cred.credentialId), publicKey: new Uint8Array(cred.publicKey), counter: Number(cred.signCount), transports: cred.transports as never },
      }).catch(() => null);
    }

    if (!cred || !verification?.verified || cred.user.status !== 'ACTIVE') {
      await this.lockout.registerFailure(subject, req.ip);
      await this.db.system(async (tx) => {
        await tx.loginAttempt.create({
          data: {
            userId: cred?.userId ?? null,
            email: cred?.user.email ?? '',
            result: cred && verification?.verified ? 'INACTIVE' : 'PASSKEY_FAILED',
            ip: req.ip,
            userAgent: req.userAgent?.slice(0, 512),
          },
        });
        await writeAudit(tx, selfCtx(null), { ...actorMeta(req), actorUserId: cred?.userId ?? null }, {
          entityType: 'user',
          entityId: cred?.userId ?? null,
          action: 'auth.passkey.failed',
          metadata: { reason: !challenge ? 'challenge_expired' : !cred ? 'unknown_credential' : !verification?.verified ? 'invalid_signature' : 'inactive' },
        });
      });
      if (!challenge) throw AppError.domain(ErrorCode.PASSKEY_INVALID, 'O pedido de login expirou. Tente de novo.');
      if (cred && verification?.verified) throw new AppError(ErrorCode.INVALID_CREDENTIALS, 401, 'Esta conta está inativa.');
      throw new AppError(ErrorCode.PASSKEY_INVALID, 401, 'Passkey não reconhecida. Entre com e-mail e senha.');
    }

    await this.lockout.reset(subject);
    return this.auth.completePasskeyLogin(cred.user.id, {
      credentialId: cred.id,
      name: cred.name,
      newCounter: verification.authenticationInfo.newCounter,
      backedUp: verification.authenticationInfo.credentialBackedUp,
    });
  }
}
