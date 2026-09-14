import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { effectivePermissions, ErrorCode, type SessionStage } from '@ordens/contracts';
import type { Request } from 'express';
import { SessionService } from '../../modules/auth/session.service.js';
import { ALLOWED_STAGES, IS_PUBLIC } from '../decorators.js';
import { AppError } from '../errors.js';
import { requestContext } from '../request-context.js';

/** Resolve a sessão do cookie e popula o contexto de requisição. */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = context.switchToHttp().getRequest<Request>();
    const token = (req.cookies as Record<string, string> | undefined)?.[this.sessions.cookieName];
    if (!token) throw AppError.unauthenticated('Faça login para continuar.');

    const session = await this.sessions.resolve(token);
    if (!session) throw AppError.unauthenticated();

    const allowed = this.reflector.getAllAndOverride<SessionStage[]>(ALLOWED_STAGES, targets) ?? ['ACTIVE'];
    if (!allowed.includes(session.stage)) {
      if (session.stage === 'PENDING_2FA') {
        throw new AppError(ErrorCode.TWO_FACTOR_REQUIRED, 401, 'Confirme o código de verificação em duas etapas.');
      }
      if (session.stage === 'PENDING_2FA_SETUP') {
        throw new AppError(ErrorCode.TWO_FACTOR_SETUP_REQUIRED, 403, 'Ative a verificação em duas etapas para continuar.');
      }
      if (session.stage === 'PENDING_PASSWORD_CHANGE') {
        throw new AppError(ErrorCode.PASSWORD_CHANGE_REQUIRED, 403, 'Defina uma nova senha para continuar.');
      }
      throw AppError.forbidden();
    }

    const store = requestContext.getStore();
    if (!store) throw new Error('RequestContext não inicializado');
    const m = session.membership;
    store.auth = {
      sessionId: session.sessionId,
      userId: session.userId,
      userName: session.userName,
      email: session.email,
      stage: session.stage,
      securityVersion: session.securityVersion,
      isPlatformAdmin: session.isPlatformAdmin,
      membership: m ? { ...m, orgIds: [m.organizationId] } : null,
      permissions: m ? effectivePermissions(m.roles, m.extraPermissions ?? []) : new Set(),
    };
    return true;
  }
}
