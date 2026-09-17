import { z } from 'zod';
import { GRANTABLE_PERMISSIONS, ROLE_CODES } from '../permissions.js';
import { THEMES } from '../enums.js';
import { passwordSchema } from './auth.js';

const systemRoles = z.array(z.enum(ROLE_CODES as [string, ...string[]]));
const customRoleIds = z.array(z.uuid()).max(20);

const userAccessBase = z.object({
  email: z.email().max(254).transform((v) => v.toLowerCase()),
  name: z.string().trim().min(2).max(120),
  organizationId: z.uuid(),
  roles: systemRoles.default([]),
  /** Papéis personalizados do tenant (Q35). */
  customRoleIds: customRoleIds.default([]),
});
const atLeastOneRole = (v: { roles: string[]; customRoleIds: string[] }) => v.roles.length + v.customRoleIds.length > 0;

export const inviteUserSchema = userAccessBase.refine(atLeastOneRole, { message: 'Selecione ao menos um papel', path: ['roles'] });
export type InviteUserInput = z.infer<typeof inviteUserSchema>;

/** Criação direta com senha provisória: troca obrigatória no primeiro acesso (Q36). */
export const createUserSchema = userAccessBase
  .extend({ temporaryPassword: passwordSchema })
  .refine(atLeastOneRole, { message: 'Selecione ao menos um papel', path: ['roles'] });
export type CreateUserInput = z.infer<typeof createUserSchema>;

export const userListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  q: z.string().trim().max(120).optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  organizationId: z.uuid().optional(),
  role: z.enum(ROLE_CODES as [string, ...string[]]).optional(),
});
export type UserListQuery = z.infer<typeof userListQuery>;

export const updateMembershipSchema = z.object({
  roles: systemRoles.optional(),
  customRoleIds: customRoleIds.optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
});
export type UpdateMembershipInput = z.infer<typeof updateMembershipSchema>;

/** Concessões individuais do acesso (lista completa desejada). */
export const membershipGrantsSchema = z.object({ permissions: z.array(z.enum(GRANTABLE_PERMISSIONS)) });

/** Senha provisória definida por quem tem `user.password.manage`. */
export const temporaryPasswordSchema = z.object({ temporaryPassword: passwordSchema });

export const updateSecurityPolicySchema = z.object({
  require2fa: z.boolean(),
  require2faRoles: z.array(z.enum(ROLE_CODES as [string, ...string[]])),
  viewSlaHours: z.number().int().min(1).max(720),
});
export type UpdateSecurityPolicyInput = z.infer<typeof updateSecurityPolicySchema>;

/** Acesso ativo sem 2FA confirmado (para prever o impacto de exigir 2FA). */
export interface SecurityMemberWithout2fa {
  membershipId: string;
  name: string;
  email: string;
  organization: string;
  roles: string[];
}

export interface SecurityPolicyDto {
  require2fa: boolean;
  require2faRoles: string[];
  viewSlaHours: number;
  coverage: {
    totalMembers: number;
    with2fa: number;
    /** Por papel do sistema: acessos ativos e quantos têm 2FA. */
    roles: { role: string; total: number; with2fa: number }[];
    without2fa: SecurityMemberWithout2fa[];
  };
}

export const updatePreferencesSchema = z.object({
  theme: z.enum(THEMES).optional(),
  sidebarCollapsed: z.boolean().optional(),
});

export const savedViewSchema = z.object({
  resource: z.enum(['orders']),
  name: z.string().trim().min(1).max(60),
  state: z.record(z.string(), z.unknown()),
  isDefault: z.boolean().default(false),
});

export const auditQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  entityType: z.string().max(60).optional(),
  entityId: z.uuid().optional(),
  action: z.string().max(80).optional(),
  actorUserId: z.uuid().optional(),
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
});

export interface UserListItem {
  /** Igual a membershipId (a lista é de acessos: um usuário pode estar em mais de uma organização). */
  id: string;
  membershipId: string;
  userId: string;
  name: string;
  email: string;
  organization: { id: string; name: string; kind: string };
  scope: string;
  roles: string[];
  customRoles: { id: string; name: string; status: 'ACTIVE' | 'ARCHIVED' }[];
  /** Concessões individuais (Q34). */
  grants: string[];
  status: string;
  twoFactorEnabled: boolean;
  lastLoginAt: string | null;
  /** Convidado que ainda não definiu a senha. */
  invitePending: boolean;
  /** Senha provisória definida: troca pendente no próximo acesso. */
  mustChangePassword: boolean;
}

export interface InviteUserResult {
  membershipId: string;
  userId: string;
  /** false quando o e-mail já tinha conta: acesso adicionado sem convite de senha. */
  invited: boolean;
}

export interface AuditEventDto {
  id: string;
  occurredAt: string;
  actor: { id: string; name: string } | null;
  actorRole: string | null;
  entityType: string;
  entityId: string | null;
  /** Nome legível da entidade (nº da OC, carga, nome da pessoa…), quando ainda existe. */
  entityLabel: string | null;
  action: string;
  before: unknown;
  after: unknown;
  ip: string | null;
  requestId: string | null;
  correlationId: string | null;
}

/**
 * Avisos que também podem ir por e-mail (Q44). O aviso no sistema continua sempre ativo; o e-mail é
 * opcional por usuário e por tipo. Chave = tipo do evento de domínio.
 */
/** `scopes`: perfis que recebem o aviso (a tela de preferências só mostra os do perfil ativo). */
export const EMAIL_NOTIFICATION_TYPES = {
  'order.published': { group: 'Ordens', label: 'Nova ordem publicada para você', default: true, scopes: ['FARM', 'BUYER'] },
  'order.version_created': { group: 'Ordens', label: 'Ordem alterada (nova versão)', default: false, scopes: ['FARM', 'BUYER'] },
  'order.release_created': { group: 'Ordens', label: 'Nova liberação de quantidade', default: false, scopes: ['FARM', 'BUYER'] },
  'order.suspended': { group: 'Ordens', label: 'Ordem suspensa', default: true, scopes: ['FARM', 'BUYER'] },
  'order.resumed': { group: 'Ordens', label: 'Ordem retomada', default: true, scopes: ['FARM', 'BUYER'] },
  'order.cancelled': { group: 'Ordens', label: 'Ordem cancelada', default: true, scopes: ['FARM', 'BUYER'] },
  'order.publish_requested': { group: 'Ordens', label: 'Pedido de publicação para aprovar', default: true, scopes: ['MATRIZ'] },
  'order.submitted': { group: 'Solicitações do Comprador', label: 'Solicitação enviada ao Faturamento', default: true, scopes: ['MATRIZ'] },
  'order.returned': { group: 'Solicitações do Comprador', label: 'Solicitação devolvida para ajuste', default: true, scopes: ['BUYER'] },
  'order.cancelled_by_buyer': { group: 'Solicitações do Comprador', label: 'Solicitação cancelada pelo Comprador', default: true, scopes: ['MATRIZ'] },
  'occurrence.opened': { group: 'Operação', label: 'Nova ocorrência', default: true, scopes: ['MATRIZ', 'FARM', 'BUYER'] },
  'invoice.processed': { group: 'Operação', label: 'NF-e rejeitada ou com divergência', default: false, scopes: ['MATRIZ', 'FARM'] },
} as const satisfies Record<string, { group: string; label: string; default: boolean; scopes: readonly ('MATRIZ' | 'FARM' | 'BUYER')[] }>;
export type EmailNotificationType = keyof typeof EMAIL_NOTIFICATION_TYPES;
export const EMAIL_NOTIFICATION_TYPE_KEYS = Object.keys(EMAIL_NOTIFICATION_TYPES) as EmailNotificationType[];

export const emailNotificationPrefsSchema = z.strictObject({
  enabled: z.boolean(),
  types: z.partialRecord(z.enum(EMAIL_NOTIFICATION_TYPE_KEYS as [EmailNotificationType, ...EmailNotificationType[]]), z.boolean()),
});
export type EmailNotificationPrefs = z.infer<typeof emailNotificationPrefsSchema>;

/** Preferência efetiva: sem registro vale o padrão do tipo; e-mail geral desligado bloqueia todos. */
export function wantsEmail(raw: unknown, type: string): boolean {
  if (!(type in EMAIL_NOTIFICATION_TYPES)) return false;
  const parsed = emailNotificationPrefsSchema.safeParse(raw);
  const prefs = parsed.success ? parsed.data : null;
  if (prefs && !prefs.enabled) return false;
  return prefs?.types[type as EmailNotificationType] ?? EMAIL_NOTIFICATION_TYPES[type as EmailNotificationType].default;
}

export function resolveEmailPrefs(raw: unknown): { enabled: boolean; types: Record<EmailNotificationType, boolean> } {
  const parsed = emailNotificationPrefsSchema.safeParse(raw);
  return {
    enabled: parsed.success ? parsed.data.enabled : true,
    types: Object.fromEntries(
      EMAIL_NOTIFICATION_TYPE_KEYS.map((k) => [k, (parsed.success ? parsed.data.types[k] : undefined) ?? EMAIL_NOTIFICATION_TYPES[k].default]),
    ) as Record<EmailNotificationType, boolean>,
  };
}
