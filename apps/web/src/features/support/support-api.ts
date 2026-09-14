'use client';

import type {
  CursorPage,
  LookupOption,
  Page,
  SupportBotAction,
  SupportConversationDetail,
  SupportConversationDto,
  SupportPriority,
  SupportQueue,
  SupportStatus,
  SupportSummary,
} from '@ordens/contracts';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { get, patch, post } from '@/lib/api';

// Polling de segurança: o tempo real (SSE) invalida ['support'] quando há novidade.
const POLL_MS = 20_000;

export const useMyConversations = (enabled: boolean) =>
  useQuery({ queryKey: ['support', 'mine'], queryFn: () => get<SupportConversationDto[]>('/support/conversations'), enabled, refetchInterval: POLL_MS });

export const useConversation = (id: string | null) =>
  useQuery({ queryKey: ['support', 'conversation', id], queryFn: () => get<SupportConversationDetail>(`/support/conversations/${id}`), enabled: Boolean(id), refetchInterval: POLL_MS });

export interface SupportQueueParams {
  queue?: SupportQueue;
  status?: SupportStatus[];
  assignee?: 'me' | 'none';
  q?: string;
}

export const useSupportQueue = (p: SupportQueueParams) =>
  useQuery({
    queryKey: ['support', 'queue', p],
    queryFn: ({ signal }) => get<Page<SupportConversationDto>>('/support/queue', { ...p, pageSize: 200 } as Record<string, string | number | string[] | undefined>, signal),
    placeholderData: keepPreviousData,
    refetchInterval: POLL_MS,
  });

export const useSupportSummary = () => useQuery({ queryKey: ['support', 'summary'], queryFn: () => get<SupportSummary>('/support/summary'), refetchInterval: POLL_MS });

export function useSupportMutations() {
  const qc = useQueryClient();
  const onDetail = (detail: SupportConversationDetail) => {
    qc.setQueryData(['support', 'conversation', detail.id], detail);
    void qc.invalidateQueries({ queryKey: ['support'], predicate: (q) => q.queryKey[1] !== 'conversation' || q.queryKey[2] !== detail.id });
  };
  return {
    start: useMutation({ mutationFn: (body: { message?: string; orderId?: string }) => post<SupportConversationDetail>('/support/conversations', body), onSuccess: onDetail }),
    send: useMutation({
      mutationFn: ({ id, ...body }: { id: string; body?: string; quickReply?: SupportBotAction; internal?: boolean }) =>
        post<SupportConversationDetail>(`/support/conversations/${id}/messages`, body),
      onSuccess: onDetail,
    }),
    close: useMutation({ mutationFn: (id: string) => post<SupportConversationDetail>(`/support/conversations/${id}/close`), onSuccess: onDetail }),
    assign: useMutation({
      mutationFn: ({ id, assigneeUserId }: { id: string; assigneeUserId: string | null }) => post<SupportConversationDetail>(`/support/conversations/${id}/assign`, { assigneeUserId }),
      onSuccess: onDetail,
    }),
    transition: useMutation({
      mutationFn: ({ id, to }: { id: string; to: SupportStatus }) => post<SupportConversationDetail>(`/support/conversations/${id}/transition`, { to }),
      onSuccess: onDetail,
    }),
    update: useMutation({
      mutationFn: ({ id, ...body }: { id: string; queue?: SupportQueue; priority?: SupportPriority }) => patch<SupportConversationDetail>(`/support/conversations/${id}`, body),
      onSuccess: onDetail,
    }),
  };
}

export const agentLookup = ({ q }: { q: string; cursor: string | null }) => get<CursorPage<LookupOption>>('/support/agents', { q });
