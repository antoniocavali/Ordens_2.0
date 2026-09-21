import { isIP } from 'node:net';
import type { NextFunction, Request, Response } from 'express';

/**
 * Atrás do Cloudflare Tunnel, o IP real da pessoa chega em CF-Connecting-IP (a Cloudflare sempre
 * sobrescreve o cabeçalho). Copia o valor para X-Forwarded-For, de onde o Express calcula `req.ip`
 * (com TRUST_PROXY=1). Sem cabeçalho válido, descarta o X-Forwarded-For recebido: `req.ip` vira o
 * endereço do salto anterior, nunca um valor escolhido por quem chamou.
 *
 * Só use quando a API for alcançável exclusivamente pelo túnel (nenhuma porta publicada no host).
 */
export function trustedIpHeader(header: string | undefined) {
  const name = header?.trim().toLowerCase();
  return (req: Request, _res: Response, next: NextFunction) => {
    if (name) {
      const value = req.headers[name];
      const ip = typeof value === 'string' ? value.trim() : '';
      if (ip && isIP(ip)) req.headers['x-forwarded-for'] = ip;
      else delete req.headers['x-forwarded-for'];
    }
    next();
  };
}
