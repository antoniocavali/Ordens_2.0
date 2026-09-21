import type { Request, Response } from 'express';
import { describe, expect, it } from 'vitest';
import { trustedIpHeader } from './trusted-ip.middleware.js';

function run(header: string | undefined, headers: Record<string, string>) {
  const req = { headers: { ...headers } } as unknown as Request;
  let called = false;
  trustedIpHeader(header)(req, {} as Response, () => {
    called = true;
  });
  expect(called).toBe(true);
  return req.headers['x-forwarded-for'];
}

describe('IP real atrás do Cloudflare Tunnel', () => {
  it('usa o cabeçalho configurado como origem do IP (IPv4 e IPv6)', () => {
    expect(run('cf-connecting-ip', { 'cf-connecting-ip': '203.0.113.7', 'x-forwarded-for': '1.2.3.4' })).toBe('203.0.113.7');
    expect(run('CF-Connecting-IP', { 'cf-connecting-ip': '2001:db8::1' })).toBe('2001:db8::1');
  });

  it('sem cabeçalho válido, descarta o X-Forwarded-For enviado pelo cliente', () => {
    expect(run('cf-connecting-ip', { 'x-forwarded-for': '1.2.3.4' })).toBeUndefined();
    expect(run('cf-connecting-ip', { 'cf-connecting-ip': 'não-é-ip', 'x-forwarded-for': '1.2.3.4' })).toBeUndefined();
    expect(run('cf-connecting-ip', { 'cf-connecting-ip': '1.2.3.4, 5.6.7.8' })).toBeUndefined();
  });

  it('desligado, não mexe em nada', () => {
    expect(run(undefined, { 'cf-connecting-ip': '203.0.113.7', 'x-forwarded-for': '1.2.3.4' })).toBe('1.2.3.4');
  });
});
