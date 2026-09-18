import { Logger } from '@nestjs/common';
import { ThrottlerStorageService, type ThrottlerStorage } from '@nestjs/throttler';
import type { ThrottlerStorageRecord } from '@nestjs/throttler/dist/throttler-storage-record.interface.js';
import type { Redis } from 'ioredis';

/**
 * Janela fixa por chave, atômica no Redis: o limite vale para todas as réplicas da API
 * e sobrevive a reinícios (revisão de segurança 3.1).
 * Retorno: [hits, ms até expirar a janela, bloqueado (0/1), ms até expirar o bloqueio].
 */
const INCREMENT = `
local hitsKey, blockKey = KEYS[1], KEYS[2]
local ttl, limit, blockMs = tonumber(ARGV[1]), tonumber(ARGV[2]), tonumber(ARGV[3])
local blockTtl = redis.call('PTTL', blockKey)
if blockTtl > 0 then
  return { tonumber(redis.call('GET', hitsKey) or limit + 1), redis.call('PTTL', hitsKey), 1, blockTtl }
end
local hits = redis.call('INCR', hitsKey)
if hits == 1 then redis.call('PEXPIRE', hitsKey, ttl) end
local hitsTtl = redis.call('PTTL', hitsKey)
if hits > limit then
  redis.call('SET', blockKey, '1', 'PX', blockMs)
  return { hits, hitsTtl, 1, blockMs }
end
return { hits, hitsTtl, 0, 0 }
`;

export class RedisThrottlerStorage implements ThrottlerStorage {
  private readonly logger = new Logger(RedisThrottlerStorage.name);
  /** Se o Redis cair, o limite continua valendo por instância em vez de sumir. */
  private readonly fallback = new ThrottlerStorageService();

  constructor(private readonly redis: Redis) {}

  async increment(key: string, ttl: number, limit: number, blockDuration: number, throttlerName: string): Promise<ThrottlerStorageRecord> {
    try {
      const prefix = `throttle:${throttlerName}:${key}`;
      const [hits, hitsTtl, blocked, blockTtl] = (await this.redis.eval(INCREMENT, 2, `${prefix}:hits`, `${prefix}:block`, ttl, limit, blockDuration)) as number[];
      return {
        totalHits: Number(hits),
        timeToExpire: Math.max(0, Math.ceil(Number(hitsTtl) / 1000)),
        isBlocked: Number(blocked) === 1,
        timeToBlockExpire: Math.max(0, Math.ceil(Number(blockTtl) / 1000)),
      };
    } catch (err) {
      this.logger.error({ err }, 'Redis indisponível no controle de requisições; usando limite local');
      return this.fallback.increment(key, ttl, limit, blockDuration, throttlerName);
    }
  }
}
