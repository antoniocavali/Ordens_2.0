import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Permission } from '@ordens/contracts';
import { IS_PUBLIC, PLATFORM_ONLY, REQUIRED_PERMISSIONS } from '../decorators.js';
import { AppError } from '../errors.js';
import { requestContext } from '../request-context.js';

/** Valida permissões da membership ativa. O RLS no banco é a segunda camada. */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const auth = requestContext.getStore()?.auth;
    if (!auth) throw AppError.unauthenticated();

    if (this.reflector.getAllAndOverride<boolean>(PLATFORM_ONLY, targets) && !auth.isPlatformAdmin) {
      throw AppError.forbidden();
    }

    const required = this.reflector.getAllAndOverride<Permission[]>(REQUIRED_PERMISSIONS, targets);
    if (!required?.length) return true;

    if (!auth.membership) throw AppError.forbidden('Selecione uma organização para continuar.');
    const missing = required.filter((p) => !auth.permissions.has(p));
    if (missing.length) throw AppError.forbidden();
    return true;
  }
}
