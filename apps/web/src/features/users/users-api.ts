'use client';

import type { InviteUserInput, InviteUserResult, Page, UserListItem } from '@ordens/contracts';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { get, patch, post } from '@/lib/api';

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

export function useUserMutations() {
  const qc = useQueryClient();
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['users'] });
    // Papéis mudam quem pode atender (equipe do atendimento).
    void qc.invalidateQueries({ queryKey: ['support', 'team'] });
  };
  return {
    invite: useMutation({ mutationFn: (body: InviteUserInput) => post<InviteUserResult>('/users/invite', body), onSuccess: refresh }),
    update: useMutation({
      mutationFn: ({ id, ...body }: { id: string; roles?: string[]; status?: 'ACTIVE' | 'INACTIVE' }) => patch<void>(`/users/memberships/${id}`, body),
      onSuccess: refresh,
    }),
    resend: useMutation({ mutationFn: (id: string) => post<void>(`/users/memberships/${id}/resend-invite`), onSuccess: refresh }),
  };
}
