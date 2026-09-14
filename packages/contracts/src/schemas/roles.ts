import { z } from 'zod';
import { CUSTOM_ROLE_SCOPES, PERMISSION_CODES, type Permission } from '../permissions.js';

export const customRoleInputSchema = z.object({
  name: z.string().trim().min(3, 'Informe um nome com pelo menos 3 caracteres').max(60),
  description: z.string().trim().max(200).nullish().transform((v) => v || null),
  scope: z.enum(CUSTOM_ROLE_SCOPES),
  permissions: z.array(z.enum(PERMISSION_CODES as [Permission, ...Permission[]])).min(1, 'Selecione ao menos uma permissão'),
});
export type CustomRoleInput = z.infer<typeof customRoleInputSchema>;

export interface RoleDto {
  /** Papel do sistema: código (ex.: MATRIZ_ADMIN). Personalizado: uuid. */
  id: string;
  name: string;
  description: string | null;
  scope: string;
  system: boolean;
  status: 'ACTIVE' | 'ARCHIVED';
  permissions: Permission[];
  membersCount: number;
  updatedAt: string | null;
}
