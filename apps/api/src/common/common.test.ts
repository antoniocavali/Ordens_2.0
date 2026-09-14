import { randomBytes } from 'node:crypto';
import { orderDraftSchema } from '@ordens/contracts';
import { describe, expect, it } from 'vitest';
import { decrypt, encrypt, hmac, safeEqual, sha256, toHex } from '../modules/auth/crypto.js';
import { AppError } from './errors.js';
import { ZodPipe } from './zod.pipe.js';

describe('crypto', () => {
  const key = randomBytes(32);

  it('AES-256-GCM cifra e decifra', () => {
    const payload = encrypt(key, 'JBSWY3DPEHPK3PXP');
    expect(Buffer.from(payload).toString('utf8')).not.toContain('JBSWY3DPEHPK3PXP');
    expect(decrypt(key, payload)).toBe('JBSWY3DPEHPK3PXP');
  });

  it('AES-256-GCM rejeita chave errada ou conteúdo adulterado', () => {
    const payload = encrypt(key, 'segredo');
    expect(() => decrypt(randomBytes(32), payload)).toThrow();
    const tampered = new Uint8Array(payload);
    tampered[tampered.length - 1] = tampered[tampered.length - 1]! ^ 0xff;
    expect(() => decrypt(key, tampered)).toThrow();
  });

  it('sha256 e hmac são determinísticos; safeEqual compara em tempo constante', () => {
    expect(toHex(sha256('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(hmac(key, 'sessao-1')).toBe(hmac(key, 'sessao-1'));
    expect(hmac(key, 'sessao-1')).not.toBe(hmac(key, 'sessao-2'));
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });
});

describe('ZodPipe', () => {
  const pipe = new ZodPipe(orderDraftSchema);

  it('retorna dados transformados quando válidos', () => {
    expect(pipe.transform({ destinationState: 'mt' })).toMatchObject({ destinationState: 'MT' });
  });

  it('lança AppError 422 com erros por campo', () => {
    try {
      pipe.transform({ quantity: '1,5', loadingStartsOn: '2026-10-10', loadingEndsOn: '2026-09-01' });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      const e = err as AppError;
      expect(e.status).toBe(422);
      expect(e.code).toBe('VALIDATION_FAILED');
      const fields = (e.details as { fields: Record<string, string[]> }).fields;
      expect(Object.keys(fields)).toEqual(expect.arrayContaining(['quantity', 'loadingEndsOn']));
    }
  });
});

describe('AppError', () => {
  it('fábricas usam status e códigos estáveis', () => {
    expect(AppError.unauthenticated().status).toBe(401);
    expect(AppError.forbidden().code).toBe('FORBIDDEN');
    expect(AppError.notFound().status).toBe(404);
    expect(AppError.conflict('x').status).toBe(409);
  });
});
