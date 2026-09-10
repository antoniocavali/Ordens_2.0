import { randomInt } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { ErrorCode, type TwoFactorConfirmResponse, type TwoFactorSetupResponse } from '@ordens/contracts';
import { Database, hashPassword, verifyPassword, writeAudit, type DbContext } from '@ordens/db';
import { generate, generateSecret, generateURI } from 'otplib';
import QRCode from 'qrcode';
import { ENV, type Env } from '../../config/env.js';
import { AppError } from '../../common/errors.js';
import { actorMeta, currentAuth } from '../../common/request-context.js';
import { decrypt, encrypt, safeEqual } from './crypto.js';
import { SessionService } from './session.service.js';

const PERIOD = 30;
const RECOVERY_CODE_COUNT = 10;
const RECOVERY_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
const ISSUER = 'Ordens TMS';

const selfCtx = (userId: string, tenantId: string | null = null): DbContext => ({
  tenantId,
  userId,
  membershipId: null,
  scope: 'SYSTEM',
  orgIds: [],
});

/** TOTP (RFC 6238) com proteção contra replay e recovery codes com hash Argon2id. */
@Injectable()
export class TwoFactorService {
  private readonly key: Buffer;

  constructor(
    private readonly db: Database,
    private readonly sessions: SessionService,
    @Inject(ENV) env: Env,
  ) {
    this.key = Buffer.from(env.TWO_FACTOR_ENC_KEY, 'base64');
  }

  async isEnabled(userId: string): Promise<boolean> {
    const cred = await this.db.run(selfCtx(userId), (tx) =>
      tx.twoFactorCredential.findUnique({ where: { userId }, select: { confirmedAt: true } }),
    );
    return Boolean(cred?.confirmedAt);
  }

  async setup(): Promise<TwoFactorSetupResponse> {
    const auth = currentAuth();
    const secret = generateSecret({ length: 20 });
    await this.db.run(selfCtx(auth.userId, auth.membership?.tenantId), async (tx) => {
      const existing = await tx.twoFactorCredential.findUnique({ where: { userId: auth.userId } });
      if (existing?.confirmedAt) {
        throw AppError.conflict('A verificação em duas etapas já está ativa.');
      }
      const secretEnc = encrypt(this.key, secret);
      await tx.twoFactorCredential.upsert({
        where: { userId: auth.userId },
        create: { userId: auth.userId, secretEnc },
        update: { secretEnc, confirmedAt: null, lastTimeStep: null },
      });
      await writeAudit(tx, selfCtx(auth.userId, auth.membership?.tenantId), actorMeta(), {
        entityType: 'user',
        entityId: auth.userId,
        action: 'auth.2fa.setup_started',
      });
    });

    const otpauthUrl = generateURI({ issuer: ISSUER, label: auth.email, secret, period: PERIOD, digits: 6 });
    const svg = await QRCode.toString(otpauthUrl, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
    return {
      otpauthUrl,
      secret,
      qrCodeDataUrl: `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`,
    };
  }

  async confirm(code: string): Promise<TwoFactorConfirmResponse> {
    const auth = currentAuth();
    const codes = Array.from({ length: RECOVERY_CODE_COUNT }, () => randomRecoveryCode());
    const hashes = await Promise.all(codes.map((c) => hashPassword(c)));

    await this.db.run(selfCtx(auth.userId, auth.membership?.tenantId), async (tx) => {
      const cred = await tx.twoFactorCredential.findUnique({ where: { userId: auth.userId } });
      if (!cred) throw AppError.domain(ErrorCode.VALIDATION_FAILED, 'Inicie a configuração novamente.');
      if (cred.confirmedAt) throw AppError.conflict('A verificação em duas etapas já está ativa.');

      const step = await this.matchStep(decrypt(this.key, cred.secretEnc), code, null);
      if (step === null) throw AppError.domain(ErrorCode.TWO_FACTOR_INVALID, 'Código inválido. Confira o horário do seu celular.');

      await tx.twoFactorCredential.update({
        where: { userId: auth.userId },
        data: { confirmedAt: new Date(), lastTimeStep: BigInt(step) },
      });
      await tx.recoveryCode.deleteMany({ where: { userId: auth.userId } });
      await tx.recoveryCode.createMany({ data: hashes.map((codeHash) => ({ userId: auth.userId, codeHash })) });
      await tx.user.update({ where: { id: auth.userId }, data: { twoFactorEnabled: true } });
      await writeAudit(tx, selfCtx(auth.userId, auth.membership?.tenantId), actorMeta(), {
        entityType: 'user',
        entityId: auth.userId,
        action: 'auth.2fa.enabled',
      });
    });
    return { recoveryCodes: codes };
  }

  /**
   * Verifica código de login: TOTP (com anti-replay) ou recovery code (consumido).
   * Retorna o método usado ou null.
   */
  async verifyLoginCode(userId: string, rawCode: string): Promise<'TOTP' | 'RECOVERY' | null> {
    const code = rawCode.trim().toLowerCase().replace(/\s+/g, '');
    return this.db.run(selfCtx(userId), async (tx) => {
      const cred = await tx.twoFactorCredential.findUnique({ where: { userId } });
      if (!cred?.confirmedAt) return null;

      if (/^\d{6}$/.test(code)) {
        const last = cred.lastTimeStep === null ? null : Number(cred.lastTimeStep);
        const step = await this.matchStep(decrypt(this.key, cred.secretEnc), code, last);
        if (step === null) return null;
        // Atualização condicional: duas requisições simultâneas com o mesmo código não passam ambas.
        const updated = await tx.twoFactorCredential.updateMany({
          where: { userId, OR: [{ lastTimeStep: null }, { lastTimeStep: { lt: BigInt(step) } }] },
          data: { lastTimeStep: BigInt(step) },
        });
        return updated.count === 1 ? 'TOTP' : null;
      }

      const normalized = code.replace(/-/g, '');
      if (normalized.length !== 10) return null;
      const formatted = `${normalized.slice(0, 4)}-${normalized.slice(4, 8)}-${normalized.slice(8)}`;
      const candidates = await tx.recoveryCode.findMany({ where: { userId, usedAt: null } });
      for (const candidate of candidates) {
        if (await verifyPassword(candidate.codeHash, formatted)) {
          const used = await tx.recoveryCode.updateMany({ where: { id: candidate.id, usedAt: null }, data: { usedAt: new Date() } });
          return used.count === 1 ? 'RECOVERY' : null;
        }
      }
      return null;
    });
  }

  async disable(password: string, code: string): Promise<void> {
    const auth = currentAuth();
    const user = await this.db.run(selfCtx(auth.userId), (tx) => tx.user.findUniqueOrThrow({ where: { id: auth.userId } }));
    if (!(await verifyPassword(user.passwordHash ?? '', password))) {
      throw AppError.domain(ErrorCode.INVALID_CREDENTIALS, 'Senha incorreta.');
    }
    if (!(await this.verifyLoginCode(auth.userId, code))) {
      throw AppError.domain(ErrorCode.TWO_FACTOR_INVALID, 'Código de verificação inválido.');
    }
    await this.db.run(selfCtx(auth.userId, auth.membership?.tenantId), async (tx) => {
      await tx.recoveryCode.deleteMany({ where: { userId: auth.userId } });
      await tx.twoFactorCredential.deleteMany({ where: { userId: auth.userId } });
      await tx.user.update({ where: { id: auth.userId }, data: { twoFactorEnabled: false } });
      await this.sessions.bumpSecurityVersion(tx, auth.userId, 'two_factor_disabled');
      await writeAudit(tx, selfCtx(auth.userId, auth.membership?.tenantId), actorMeta(), {
        entityType: 'user',
        entityId: auth.userId,
        action: 'auth.2fa.disabled',
      });
    });
  }

  async regenerateRecoveryCodes(code: string): Promise<TwoFactorConfirmResponse> {
    const auth = currentAuth();
    if (!(await this.verifyLoginCode(auth.userId, code))) {
      throw AppError.domain(ErrorCode.TWO_FACTOR_INVALID, 'Código de verificação inválido.');
    }
    const codes = Array.from({ length: RECOVERY_CODE_COUNT }, () => randomRecoveryCode());
    const hashes = await Promise.all(codes.map((c) => hashPassword(c)));
    await this.db.run(selfCtx(auth.userId, auth.membership?.tenantId), async (tx) => {
      await tx.recoveryCode.deleteMany({ where: { userId: auth.userId } });
      await tx.recoveryCode.createMany({ data: hashes.map((codeHash) => ({ userId: auth.userId, codeHash })) });
      await writeAudit(tx, selfCtx(auth.userId, auth.membership?.tenantId), actorMeta(), {
        entityType: 'user',
        entityId: auth.userId,
        action: 'auth.2fa.recovery_codes_regenerated',
      });
    });
    return { recoveryCodes: codes };
  }

  async remainingRecoveryCodes(userId: string): Promise<number> {
    return this.db.run(selfCtx(userId), (tx) => tx.recoveryCode.count({ where: { userId, usedAt: null } }));
  }

  /** Procura o passo de tempo (janela ±1) cujo código confere; ignora passos já usados. */
  private async matchStep(secret: string, code: string, lastUsedStep: number | null): Promise<number | null> {
    const nowStep = Math.floor(Date.now() / 1000 / PERIOD);
    for (const offset of [0, -1, 1]) {
      const step = nowStep + offset;
      if (lastUsedStep !== null && step <= lastUsedStep) continue;
      const expected = await generate({ secret, epoch: step * PERIOD, period: PERIOD, digits: 6 });
      if (safeEqual(expected, code)) return step;
    }
    return null;
  }
}

function randomRecoveryCode(): string {
  const chars = Array.from({ length: 10 }, () => RECOVERY_ALPHABET[randomInt(RECOVERY_ALPHABET.length)]).join('');
  return `${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8)}`;
}
