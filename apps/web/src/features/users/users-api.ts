'use client';

import type { CreateUserInput, CustomRoleInput, GrantablePermission, InviteUserInput, InviteUserResult, Page, RoleDto, UserListItem } from '@ordens/contracts';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { get, patch, post, put } from '@/lib/api';

export interface OrganizationOption {
  id: string;
  name: string;
  kind: string;
  status: string;
}

export interface UserListParams {
  page: number;
  pageSize: number;
  q?: string;
  status?: string;
  organizationId?: string;
}

export const useUsers = (p: UserListParams) =>
  useQuery({
    queryKey: ['users', p],
    queryFn: ({ signal }) => get<Page<UserListItem>>('/users', p as unknown as Record<string, string | number | undefined>, signal),
    placeholderData: keepPreviousData,
  });

export const useOrganizations = () => useQuery({ queryKey: ['organizations'], queryFn: () => get<OrganizationOption[]>('/organizations'), staleTime: 60_000 });

/** Papéis do sistema e personalizados do tenant (Q35). */
export const useRoles = (enabled = true) => useQuery({ queryKey: ['roles'], queryFn: () => get<RoleDto[]>('/roles'), staleTime: 30_000, enabled });

export function useUserMutations() {
  const qc = useQueryClient();
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['users'] });
    void qc.invalidateQueries({ queryKey: ['roles'] });
    // Papéis mudam quem pode atender (equipe do atendimento).
    void qc.invalidateQueries({ queryKey: ['support', 'team'] });
  };
  return {
    invite: useMutation({ mutationFn: (body: InviteUserInput) => post<InviteUserResult>('/users/invite', body), onSuccess: refresh }),
    create: useMutation({ mutationFn: (body: CreateUserInput) => post<InviteUserResult>('/users', body), onSuccess: refresh }),
    update: useMutation({
      mutationFn: ({ id, ...body }: { id: string; roles?: string[]; customRoleIds?: string[]; status?: 'ACTIVE' | 'INACTIVE' }) => patch<void>(`/users/memberships/${id}`, body),
      onSuccess: refresh,
    }),
    resend: useMutation({ mutationFn: (id: string) => post<void>(`/users/memberships/${id}/resend-invite`), onSuccess: refresh }),
    grants: useMutation({
      mutationFn: ({ id, permissions }: { id: string; permissions: GrantablePermission[] }) => put<{ grants: string[] }>(`/users/memberships/${id}/grants`, { permissions }),
      onSuccess: refresh,
    }),
    temporaryPassword: useMutation({
      mutationFn: ({ id, temporaryPassword }: { id: string; temporaryPassword: string }) => post<void>(`/users/memberships/${id}/password`, { temporaryPassword }),
      onSuccess: refresh,
    }),
  };
}

export function useRoleMutations() {
  const qc = useQueryClient();
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['roles'] });
    void qc.invalidateQueries({ queryKey: ['users'] });
  };
  return {
    create: useMutation({ mutationFn: (body: CustomRoleInput) => post<RoleDto>('/roles', body), onSuccess: refresh }),
    update: useMutation({ mutationFn: ({ id, ...body }: CustomRoleInput & { id: string }) => put<RoleDto>(`/roles/${id}`, body), onSuccess: refresh }),
    archive: useMutation({ mutationFn: (id: string) => post<RoleDto>(`/roles/${id}/archive`), onSuccess: refresh }),
    restore: useMutation({ mutationFn: (id: string) => post<RoleDto>(`/roles/${id}/restore`), onSuccess: refresh }),
  };
}

/** Senha provisória forte (sem caracteres ambíguos) gerada no navegador. */
export function generateTemporaryPassword(length = 14) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%&*';
  const bytes = crypto.getRandomValues(new Uint32Array(length));
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}
