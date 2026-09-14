import { Inject, Injectable, Logger } from '@nestjs/common';
import { ErrorCode } from '@ordens/contracts';
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
 */
@Injectable()
export class LockoutService {
  private readonly logger = new Logger(LockoutService.name);

  constructor(@Inject(REDIS) private readonly redis: Redis) {}

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
      this.logger.error({ err }, 'Redis indisponível no controle de lockout');
    }
  }

  /** Registra falha e retorna o bloqueio aplicado em segundos (0 se nenhum). */
  async registerFailure(subject: string, ip: string | null): Promise<number> {
    try {
      const applied = await this.bump(subject, FREE_ATTEMPTS);
      if (ip) await this.bump(`ip:${ip}`, IP_FREE_ATTEMPTS);
      return applied;
    } catch (err) {
      this.logger.error({ err }, 'Redis indisponível ao registrar falha de login');
      return 0;
    }
  }

  async reset(subject: string): Promise<void> {
    await this.redis.del(`lock:count:${subject}`, `lock:until:${subject}`).catch(() => undefined);
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

function formatWait(seconds: number): string {
  if (seconds < 60) return `${seconds} segundos`;
  const minutes = Math.ceil(seconds / 60);
  return minutes === 1 ? '1 minuto' : `${minutes} minutos`;
}
