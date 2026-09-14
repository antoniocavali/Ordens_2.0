import { z } from 'zod';
import { type Scope, type THEMES } from '../enums.js';
import type { Permission } from '../permissions.js';
import type { SupportQueue } from './support.js';

export const PASSWORD_MIN_LENGTH = 12;

export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `A senha deve ter pelo menos ${PASSWORD_MIN_LENGTH} caracteres`)
  .max(256);

export const loginSchema = z.object({
  email: z.email('E-mail inválido').max(254).transform((v) => v.toLowerCase()),
  password: z.string().min(1, 'Informe a senha').max(256),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const twoFactorVerifySchema = z.object({
  code: z
    .string()
    .trim()
    .min(6)
    .max(20)
    .regex(/^[0-9a-zA-Z-]+$/, 'Código inválido'),
});
export type TwoFactorVerifyInput = z.infer<typeof twoFactorVerifySchema>;

export const twoFactorConfirmSchema = z.object({
  code: z.string().trim().regex(/^\d{6}$/, 'Informe os 6 dígitos'),
});

export const twoFactorDisableSchema = z.object({
  password: z.string().min(1).max(256),
  code: z.string().trim().min(6).max(20),
});

export const passwordForgotSchema = z.object({
  email: z.email().max(254).transform((v) => v.toLowerCase()),
});

export const passwordResetSchema = z.object({
  token: z.string().min(20).max(200),
  password: passwordSchema,
});

export const passwordChangeSchema = z.object({
  currentPassword: z.string().min(1).max(256),
  newPassword: passwordSchema,
  code: z.string().trim().max(20).optional(),
});

export const switchContextSchema = z.object({
  membershipId: z.uuid(),
});

export const SessionStage = {
  PENDING_2FA: 'PENDING_2FA',
  PENDING_2FA_SETUP: 'PENDING_2FA_SETUP',
  ACTIVE: 'ACTIVE',
} as const;
export type SessionStage = (typeof SessionStage)[keyof typeof SessionStage];

export interface MembershipSummary {
  id: string;
  tenant: { id: string; name: string; slug: string };
  organization: { id: string; name: string; kind: string };
  scope: Scope;
  roles: string[];
}

export interface MeResponse {
  user: {
    id: string;
    name: string;
    email: string;
    twoFactorEnabled: boolean;
    theme: (typeof THEMES)[number];
    sidebarCollapsed: boolean;
  };
  stage: SessionStage;
  activeMembership: MembershipSummary | null;
  memberships: MembershipSummary[];
  permissions: Permission[];
  /** Filas do atendimento que o usuário atende na membership ativa (Q31). */
  supportQueues: SupportQueue[];
  csrfToken: string;
}

export interface LoginResponse {
  stage: SessionStage;
}

export interface SessionInfo {
  id: string;
  current: boolean;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
  lastSeenAt: string;
}

export interface LoginHistoryItem {
  id: string;
  result: string;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
}

export interface TwoFactorSetupResponse {
  otpauthUrl: string;
  qrCodeDataUrl: string;
  secret: string;
}

export interface TwoFactorConfirmResponse {
  recoveryCodes: string[];
}
