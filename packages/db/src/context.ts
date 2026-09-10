/**
 * Contexto de segurança aplicado ao PostgreSQL em cada unidade transacional.
 * Mudanças neste arquivo exigem revisão de segurança (docs/multi-tenancy.md).
 */
/** NONE: usuário autenticado sem membership ativa (apenas dados da própria conta). */
export type DbScope = 'PLATFORM' | 'MATRIZ' | 'FARM' | 'BUYER' | 'CARRIER' | 'SYSTEM' | 'NONE';

export interface DbContext {
  tenantId: string | null;
  userId: string | null;
  membershipId: string | null;
  scope: DbScope;
  /** Organizações autorizadas para a membership ativa. */
  orgIds: readonly string[];
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertUuid(value: string | null, name: string): string {
  if (value === null) return '';
  if (!UUID_RE.test(value)) throw new Error(`DbContext.${name} inválido`);
  return value;
}

/** Converte o contexto em pares GUC -> valor, validando formato (nada de texto livre em GUCs). */
export function contextToSettings(ctx: DbContext): [string, string][] {
  const orgIds = ctx.orgIds.map((id) => assertUuid(id, 'orgIds'));
  return [
    ['app.tenant_id', assertUuid(ctx.tenantId, 'tenantId')],
    ['app.user_id', assertUuid(ctx.userId, 'userId')],
    ['app.membership_id', assertUuid(ctx.membershipId, 'membershipId')],
    ['app.scope', ctx.scope],
    ['app.org_ids', `{${orgIds.join(',')}}`],
  ];
}

/**
 * Contexto SYSTEM: apenas para fluxos pré-autenticação (login, reset de senha),
 * jobs cross-tenant (relay de outbox) e seed. Informe tenantId quando a operação for de um tenant.
 */
export function systemContext(tenantId: string | null = null): DbContext {
  return { tenantId, userId: null, membershipId: null, scope: 'SYSTEM', orgIds: [] };
}
