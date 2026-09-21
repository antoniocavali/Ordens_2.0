import { describe, expect, it } from 'vitest';
import { loadEnv } from './env.js';

const key = Buffer.alloc(32, 7).toString('base64');
const base = {
  WEB_ORIGIN: 'http://localhost:3020',
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
  S3_ENDPOINT: 'http://localhost:9000',
  S3_PUBLIC_ENDPOINT: 'http://localhost:9000',
  S3_ACCESS_KEY: 'minio',
  S3_SECRET_KEY: 'minio-secret',
  S3_BUCKET_QUARANTINE: 'quarantine',
  S3_BUCKET_DOCUMENTS: 'documents',
  SESSION_SECRET: key,
  TWO_FACTOR_ENC_KEY: key,
};

describe('configuração de segurança', () => {
  it('TRUST_PROXY aceita saltos fixos ou sub-redes (revisão 3.7)', () => {
    expect(loadEnv({ ...base }).TRUST_PROXY).toBe('loopback, linklocal, uniquelocal');
    expect(loadEnv({ ...base, TRUST_PROXY: '1' }).TRUST_PROXY).toBe(1);
    expect(loadEnv({ ...base, TRUST_PROXY: '10.0.0.0/8' }).TRUST_PROXY).toBe('10.0.0.0/8');
  });

  it('TRUSTED_IP_HEADER (Cloudflare Tunnel) é opcional e só aceita nome de cabeçalho', () => {
    expect(loadEnv({ ...base }).TRUSTED_IP_HEADER).toBeUndefined();
    expect(loadEnv({ ...base, TRUSTED_IP_HEADER: '' }).TRUSTED_IP_HEADER).toBeUndefined();
    expect(loadEnv({ ...base, TRUSTED_IP_HEADER: 'CF-Connecting-IP' }).TRUSTED_IP_HEADER).toBe('cf-connecting-ip');
    expect(() => loadEnv({ ...base, TRUSTED_IP_HEADER: 'x forwarded' })).toThrow(/cabeçalho/);
  });

  it('produção recusa cookie inseguro e antivírus desligado', () => {
    expect(() => loadEnv({ ...base, NODE_ENV: 'production' })).toThrow(/SCANNER=noop.*|COOKIE_SECURE/s);
  });
});
