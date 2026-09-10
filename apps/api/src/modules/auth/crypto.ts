import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** Bytes com ArrayBuffer próprio (tipo exigido pelos campos Bytes do Prisma). */
export type Bytes = Uint8Array<ArrayBuffer>;
const toBytes = (buf: Buffer): Bytes => new Uint8Array(buf);

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function sha256(value: string): Bytes {
  return toBytes(createHash('sha256').update(value).digest());
}

export function hmac(key: Uint8Array, value: string): string {
  return createHmac('sha256', key).update(value).digest('base64url');
}

export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/** AES-256-GCM: [iv(12) | tag(16) | ciphertext]. */
export function encrypt(key: Uint8Array, plaintext: string): Bytes {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return toBytes(Buffer.concat([iv, cipher.getAuthTag(), enc]));
}

export function decrypt(key: Uint8Array, payload: Uint8Array): string {
  const buf = Buffer.from(payload);
  const decipher = createDecipheriv('aes-256-gcm', key, buf.subarray(0, 12));
  decipher.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString('utf8');
}

export const toBase64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64');
export const toHex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex');
