import type { Database } from '@ordens/db';
import type { Redis } from 'ioredis';
import { describe, expect, it } from 'vitest';
import { LockoutService } from './lockout.service.js';

/** Redis fora do ar: qualquer comando falha. */
const deadRedis = new Proxy({}, { get: () => () => Promise.reject(new Error('ECONNREFUSED')) }) as unknown as Redis;

/** Banco em memória com o suficiente para o contador de falhas por usuário. */
function fakeDatabase(users: Record<string, { id: string; failedLoginCount: number; lockedUntil: Date | null }>) {
  const byEmail = (email: string) => users[email] ?? null;
  const tx = {
    user: {
      findUnique: async ({ where }: { where: { email: string } }) => byEmail(where.email),
      update: async ({ where, data }: { where: { id: string }; data: Partial<{ failedLoginCount: number; lockedUntil: Date | null }> }) => {
        const u = Object.values(users).find((x) => x.id === where.id)!;
        Object.assign(u, data);
        return u;
      },
      updateMany: async ({ where, data }: { where: { email: string }; data: Partial<{ failedLoginCount: number; lockedUntil: Date | null }> }) => {
        const u = byEmail(where.email);
        if (u) Object.assign(u, data);
        return { count: u ? 1 : 0 };
      },
    },
  };
  return { system: <T>(fn: (t: typeof tx) => Promise<T>) => fn(tx) } as unknown as Database;
}

describe('bloqueio de login com Redis indisponível (revisão 3.4)', () => {
  it('continua contando no banco e bloqueia após as tentativas livres', async () => {
    const users = { 'ana@x.demo': { id: 'u1', failedLoginCount: 0, lockedUntil: null as Date | null } };
    const lockout = new LockoutService(deadRedis, fakeDatabase(users));
    const subject = 'login:ana@x.demo';

    for (let i = 0; i < 5; i++) {
      await lockout.assertAllowed(subject, '203.0.113.1');
      expect(await lockout.registerFailure(subject, '203.0.113.1')).toBe(0);
    }
    // Sexta falha: bloqueio progressivo gravado no usuário.
    expect(await lockout.registerFailure(subject, '203.0.113.1')).toBe(30);
    expect(users['ana@x.demo'].lockedUntil).not.toBeNull();
    await expect(lockout.assertAllowed(subject, '203.0.113.1')).rejects.toMatchObject({ status: 429 });

    // Login bem-sucedido (reset) libera a conta.
    await lockout.reset(subject);
    expect(users['ana@x.demo']).toMatchObject({ failedLoginCount: 0, lockedUntil: null });
    await expect(lockout.assertAllowed(subject, '203.0.113.1')).resolves.toBeUndefined();
  });

  it('identificador inexistente não quebra nem revela a conta', async () => {
    const lockout = new LockoutService(deadRedis, fakeDatabase({}));
    await expect(lockout.assertAllowed('login:ninguem@x.demo', null)).resolves.toBeUndefined();
    expect(await lockout.registerFailure('login:ninguem@x.demo', null)).toBe(0);
  });
});
