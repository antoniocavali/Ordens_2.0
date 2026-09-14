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
  action: string;
  before: unknown;
  after: unknown;
  ip: string | null;
  requestId: string | null;
  correlationId: string | null;
}
