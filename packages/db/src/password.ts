import { hash, verify } from '@node-rs/argon2';

/** Parâmetros Argon2id (mínimo OWASP). Alterações disparam re-hash transparente no login. */
export const ARGON2_OPTIONS = {
  algorithm: 2, // Argon2id
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
  outputLen: 32,
} as const;

export function hashPassword(plain: string): Promise<string> {
  return hash(plain, ARGON2_OPTIONS);
}

export async function verifyPassword(hashValue: string, plain: string): Promise<boolean> {
  try {
    return await verify(hashValue, plain);
  } catch {
    return false;
  }
}

/** Indica se o hash foi gerado com parâmetros diferentes dos atuais. */
export function needsRehash(hashValue: string): boolean {
  const expected = `$argon2id$v=19$m=${ARGON2_OPTIONS.memoryCost},t=${ARGON2_OPTIONS.timeCost},p=${ARGON2_OPTIONS.parallelism}$`;
  return !hashValue.startsWith(expected);
}

/** Hash usado para comparar em tempo constante quando o usuário não existe. */
export const DUMMY_PASSWORD_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHRzb21lc2FsdA$Xw1kqUjMR9mY6x3VqNgt2c1q1W2mS1kR0y5bH3c9p2E';
