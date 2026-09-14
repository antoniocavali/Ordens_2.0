import { z } from 'zod';
import { ROLE_CODES } from '../permissions.js';
import { THEMES } from '../enums.js';

export const inviteUserSchema = z.object({
  email: z.email().max(254).transform((v) => v.toLowerCase()),
  name: z.string().trim().min(2).max(120),
  organizationId: z.uuid(),
  roles: z.array(z.enum(ROLE_CODES as [string, ...string[]])).min(1),
});
export type InviteUserInput = z.infer<typeof inviteUserSchema>;

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
  roles: z.array(z.enum(ROLE_CODES as [string, ...string[]])).min(1).optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
});

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
  status: string;
  twoFactorEnabled: boolean;
  lastLoginAt: string | null;
  /** Convidado que ainda não definiu a senha. */
  invitePending: boolean;
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
