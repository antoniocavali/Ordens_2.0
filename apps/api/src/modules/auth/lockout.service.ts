import { Inject, Injectable, Logger } from '@nestjs/common';
import { ErrorCode } from '@ordens/contracts';
import { Database } from '@ordens/db';
import type { Redis } from 'ioredis';
import { AppError } from '../../common/errors.js';
import { REDIS } from '../../infra/infra.module.js';

const FREE_ATTEMPTS = 5;
const BASE_DELAY_S = 30;
const MAX_DELAY_S = 15 * 60;
const WINDOW_S = 60 * 60;
/** Limite mais alto por IP (NAT corporativo compartilha IP). */
const IP_FREE_ATTEMPTS = 30;

/**
 * Bloqueio progressivo por identificador (e-mail/usuário) e por IP.
 * Aplica-se exista ou não o usuário, evitando enumeração de contas.
 *
 * Redis é o contador principal. Se ele cair, o bloqueio por conta continua no PostgreSQL
 * (`users.failed_login_count` / `locked_until`) em vez de liberar tentativas ilimitadas
 * (revisão de segurança 3.4). Vale para identificadores de login (`login:<e-mail>`).
 */
@Injectable()
export class LockoutService {
  private readonly logger = new Logger(LockoutService.name);

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    private readonly db: Database,
  ) {}

  async assertAllowed(subject: string, ip: string | null): Promise<void> {
    const keys = [`lock:until:${subject}`, ...(ip ? [`lock:until:ip:${ip}`] : [])];
    try {
      const values = await this.redis.mget(...keys);
      const until = Math.max(0, ...values.map((v) => Number(v ?? 0)));
      const waitS = Math.ceil((until - Date.now()) / 1000);
      if (waitS > 0) {
        throw new AppError(ErrorCode.ACCOUNT_LOCKED, 429, `Muitas tentativas. Tente novamente em ${formatWait(waitS)}.`, {
          retryAfterSeconds: waitS,
        });
      }
    } catch (err) {
      if (err instanceof AppError) throw err;
      this.logger.error({ err, fallback: 'database' }, 'Redis indisponível no controle de lockout; usando o banco');
      await this.assertAllowedInDatabase(subject);
    }
  }

  /** Registra falha e retorna o bloqueio aplicado em segundos (0 se nenhum). */
  async registerFailure(subject: string, ip: string | null): Promise<number> {
    try {
      const applied = await this.bump(subject, FREE_ATTEMPTS);
      if (ip) await this.bump(`ip:${ip}`, IP_FREE_ATTEMPTS);
      return applied;
    } catch (err) {
      this.logger.error({ err, fallback: 'database' }, 'Redis indisponível ao registrar falha de login; usando o banco');
      return this.registerFailureInDatabase(subject);
    }
  }

  async reset(subject: string): Promise<void> {
    await this.redis.del(`lock:count:${subject}`, `lock:until:${subject}`).catch(() => undefined);
    const email = loginEmail(subject);
    if (email) {
      await this.db
        .system((tx) => tx.user.updateMany({ where: { email, OR: [{ failedLoginCount: { gt: 0 } }, { lockedUntil: { not: null } }] }, data: { failedLoginCount: 0, lockedUntil: null } }))
        .catch((err: unknown) => this.logger.error({ err }, 'Falha ao zerar o bloqueio no banco'));
    }
  }

  private async assertAllowedInDatabase(subject: string): Promise<void> {
    const email = loginEmail(subject);
    if (!email) return;
    const user = await this.db.system((tx) => tx.user.findUnique({ where: { email }, select: { lockedUntil: true } }));
    const waitS = user?.lockedUntil ? Math.ceil((user.lockedUntil.getTime() - Date.now()) / 1000) : 0;
    if (waitS > 0) {
      throw new AppError(ErrorCode.ACCOUNT_LOCKED, 429, `Muitas tentativas. Tente novamente em ${formatWait(waitS)}.`, { retryAfterSeconds: waitS });
    }
  }

  /** Mesma progressão do Redis, gravada no usuário (identificadores inexistentes não têm onde contar). */
  private async registerFailureInDatabase(subject: string): Promise<number> {
    const email = loginEmail(subject);
    if (!email) return 0;
    try {
      return await this.db.system(async (tx) => {
        const user = await tx.user.findUnique({ where: { email }, select: { id: true, failedLoginCount: true } });
        if (!user) return 0;
        const count = user.failedLoginCount + 1;
        const delay = count <= FREE_ATTEMPTS ? 0 : Math.min(BASE_DELAY_S * 2 ** (count - FREE_ATTEMPTS - 1), MAX_DELAY_S);
        await tx.user.update({
          where: { id: user.id },
          data: { failedLoginCount: count, ...(delay ? { lockedUntil: new Date(Date.now() + delay * 1000) } : {}) },
        });
        return delay;
      });
    } catch (err) {
      this.logger.error({ err }, 'Falha também no banco ao registrar tentativa de login');
      return 0;
    }
  }

  private async bump(subject: string, free: number): Promise<number> {
    const countKey = `lock:count:${subject}`;
    const count = await this.redis.incr(countKey);
    if (count === 1) await this.redis.expire(countKey, WINDOW_S);
    if (count <= free) return 0;
    const delay = Math.min(BASE_DELAY_S * 2 ** (count - free - 1), MAX_DELAY_S);
    await this.redis.set(`lock:until:${subject}`, String(Date.now() + delay * 1000), 'EX', delay);
    return delay;
  }
}

/** `login:<e-mail>` → e-mail; outros identificadores (2FA, recuperação) não têm contador no banco. */
function loginEmail(subject: string): string | null {
  return subject.startsWith('login:') ? subject.slice('login:'.length) : null;
}

function formatWait(seconds: number): string {
  if (seconds < 60) return `${seconds} segundos`;
  const minutes = Math.ceil(seconds / 60);
  return minutes === 1 ? '1 minuto' : `${minutes} minutos`;
}
