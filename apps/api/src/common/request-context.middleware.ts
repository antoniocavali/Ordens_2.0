import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { requestContext } from './request-context.js';

const SAFE_ID = /^[A-Za-z0-9._:-]{8,64}$/;

/** Inicializa o contexto da requisição (requestId, correlationId, IP, User-Agent). */
export function requestContextMiddleware(req: Request, res: Response, next: NextFunction) {
  const incomingRequestId = req.headers['x-request-id'];
  const incomingCorrelation = req.headers['x-correlation-id'];
  const requestId = typeof incomingRequestId === 'string' && SAFE_ID.test(incomingRequestId) ? incomingRequestId : randomUUID();
  const correlationId =
    typeof incomingCorrelation === 'string' && SAFE_ID.test(incomingCorrelation) ? incomingCorrelation : requestId;

  (req as Request & { id: string }).id = requestId;
  res.setHeader('x-request-id', requestId);

  requestContext.run(
    {
      requestId,
      correlationId,
      ip: normalizeIp(req.ip),
      userAgent: req.headers['user-agent']?.slice(0, 512) ?? null,
    },
    next,
  );
}

function normalizeIp(ip: string | undefined): string | null {
  if (!ip) return null;
  return ip.startsWith('::ffff:') ? ip.slice(7) : ip;
}
