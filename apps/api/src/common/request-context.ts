import { AsyncLocalStorage } from 'node:async_hooks';
import type { Permission, Scope, SessionStage } from '@ordens/contracts';
import type { ActorMeta, DbContext } from '@ordens/db';

export interface ActiveMembership {
  id: string;
  tenantId: string;
  organizationId: string;
  scope: Scope;
  roles: string[];
  /** Organizações autorizadas (hoje: a própria organização). */
  orgIds: string[];
}

export interface AuthState {
  sessionId: string;
  userId: string;
  userName: string;
  email: string;
  stage: SessionStage;
  securityVersion: number;
  isPlatformAdmin: boolean;
  membership: ActiveMembership | null;
  permissions: ReadonlySet<Permission>;
}

export interface RequestContextData {
  requestId: string;
  correlationId: string;
  ip: string | null;
  userAgent: string | null;
  auth?: AuthState;
}

export const requestContext = new AsyncLocalStorage<RequestContextData>();

export function currentRequest(): RequestContextData {
  const store = requestContext.getStore();
  if (!store) throw new Error('Contexto de requisição ausente');
  return store;
}

export function currentAuth(): AuthState {
  const auth = currentRequest().auth;
  if (!auth) throw new Error('Requisição não autenticada');
  return auth;
}

/** Contexto RLS derivado da membership ativa. Sem membership → apenas identidade do usuário. */
export function dbContextFor(auth: AuthState): DbContext {
  const m = auth.membership;
  return {
    tenantId: m?.tenantId ?? null,
    userId: auth.userId,
    membershipId: m?.id ?? null,
    scope: m?.scope ?? (auth.isPlatformAdmin ? 'PLATFORM' : 'NONE'),
    orgIds: m?.orgIds ?? [],
  };
}

export function actorMeta(data: RequestContextData = currentRequest()): ActorMeta {
  const auth = data.auth;
  return {
    actorUserId: auth?.userId ?? null,
    actorMembershipId: auth?.membership?.id ?? null,
    actorRole: auth?.membership?.roles.join(',') ?? (auth?.isPlatformAdmin ? 'PLATFORM_SUPERADMIN' : null),
    ip: data.ip,
    userAgent: data.userAgent,
    sessionId: auth?.sessionId ?? null,
    requestId: data.requestId,
    correlationId: data.correlationId,
  };
}
