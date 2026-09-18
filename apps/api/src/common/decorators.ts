import { createParamDecorator, SetMetadata } from '@nestjs/common';
import type { Permission, SessionStage } from '@ordens/contracts';
import { currentAuth } from './request-context.js';

export const IS_PUBLIC = 'ordens:public';
export const REQUIRED_PERMISSIONS = 'ordens:permissions';
export const ANY_PERMISSIONS = 'ordens:any-permissions';
export const ALLOWED_STAGES = 'ordens:stages';
export const REQUIRES_MEMBERSHIP = 'ordens:membership';
export const PLATFORM_ONLY = 'ordens:platform';
export const SELF_SERVICE = 'ordens:self-service';

/** Endpoint sem sessão (login, recuperação de senha, health). CSRF passa a exigir Origin válido. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Exige TODAS as permissões informadas na membership ativa. Implica membership ativa. */
export const RequirePermission = (...permissions: Permission[]) => SetMetadata(REQUIRED_PERMISSIONS, permissions);

/** Exige AO MENOS UMA das permissões informadas (ex.: atender qualquer fila). Implica membership ativa. */
export const RequireAnyPermission = (...permissions: Permission[]) => SetMetadata(ANY_PERMISSIONS, permissions);

/** Estágios de sessão aceitos (padrão: somente ACTIVE). */
export const AllowStages = (...stages: SessionStage[]) => SetMetadata(ALLOWED_STAGES, stages);

/**
 * Rota autenticada que só lê ou altera dados do próprio usuário (sessões, 2FA, preferências, avisos).
 * Não concede nada: documenta a decisão e satisfaz o teste que exige autorização explícita em toda rota.
 */
export const SelfService = () => SetMetadata(SELF_SERVICE, true);

/** Somente superadministrador da plataforma. */
export const PlatformOnly = () => SetMetadata(PLATFORM_ONLY, true);

/** Injeta o AuthState da requisição. */
export const Auth = createParamDecorator(() => currentAuth());
