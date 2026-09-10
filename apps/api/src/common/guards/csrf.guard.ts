import { type CanActivate, type ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { ErrorCode } from '@ordens/contracts';
import type { Request } from 'express';
import { ENV, type Env } from '../../config/env.js';
import { safeEqual } from '../../modules/auth/crypto.js';
import { SessionService } from '../../modules/auth/session.service.js';
import { AppError } from '../errors.js';
import { requestContext } from '../request-context.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF: métodos mutantes exigem Origin/Referer da aplicação web e,
 * quando há sessão, o header X-CSRF-Token derivado (HMAC) do id da sessão.
 * Executa após o AuthGuard.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  private readonly allowedOrigin: string;

  constructor(
    @Inject(ENV) env: Env,
    private readonly sessions: SessionService,
  ) {
    this.allowedOrigin = new URL(env.WEB_ORIGIN).origin;
  }

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    if (SAFE_METHODS.has(req.method)) return true;

    const origin = req.headers.origin ?? originFromReferer(req.headers.referer);
    const fetchSite = req.headers['sec-fetch-site'];
    if (origin ? origin !== this.allowedOrigin : fetchSite !== undefined && fetchSite !== 'same-origin') {
      throw new AppError(ErrorCode.CSRF_INVALID, 403, 'Requisição bloqueada por segurança. Recarregue a página.');
    }

    const auth = requestContext.getStore()?.auth;
    if (!auth) return true;

    const header = req.headers['x-csrf-token'];
    const expected = this.sessions.csrfTokenFor(auth.sessionId);
    if (typeof header !== 'string' || !safeEqual(header, expected)) {
      throw new AppError(ErrorCode.CSRF_INVALID, 403, 'Requisição bloqueada por segurança. Recarregue a página.');
    }
    return true;
  }
}

function originFromReferer(referer: string | undefined): string | undefined {
  if (!referer) return undefined;
  try {
    return new URL(referer).origin;
  } catch {
    return undefined;
  }
}
