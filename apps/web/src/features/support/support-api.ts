'use client';

import {
  supportQueuesFor,
  type CursorPage,
  type LookupOption,
  type Page,
  type SupportAnalytics,
  type SupportAnalyticsPeriod,
  type SupportBotAction,
  type SupportConversationDetail,
  type SupportConversationDto,
  type SupportPriority,
  type SupportQueue,
  type SupportStatus,
  type SupportSummary,
} from '@ordens/contracts';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { get, patch, post } from '@/lib/api';
import { useMe } from '@/lib/session';

// Polling de segurança: o tempo real (SSE) invalida ['support'] quando há novidade.
const POLL_MS = 20_000;

export const useMyConversations = (enabled: boolean) =>
  useQuery({ queryKey: ['support', 'mine'], queryFn: () => get<SupportConversationDto[]>('/support/conversations'), enabled, refetchInterval: POLL_MS });

export const useConversation = (id: string | null) =>
  useQuery({ queryKey: ['support', 'conversation', id], queryFn: () => get<SupportConversationDetail>(`/support/conversations/${id}`), enabled: Boolean(id), refetchInterval: POLL_MS, retry: false });

/** Filas que o usuário atende e se supervisiona o atendimento. */
export function useSupportAccess() {
  const { data: me } = useMe();
  return useMemo(() => {
    const permissions = me?.activeMembership?.scope === 'MATRIZ' ? (me?.permissions ?? []) : [];
    return { ready: Boolean(me), queues: supportQueuesFor(permissions), supervisor: permissions.includes('support.manage'), userId: me?.user.id ?? null };
  }, [me]);
}

export interface SupportQueueParams {
  queue?: SupportQueue;
  status?: SupportStatus[];
  assignee?: 'me' | 'none';
  q?: string;
}

export const useSupportQueue = (p: SupportQueueParams, enabled = true) =>
  useQuery({
    queryKey: ['support', 'queue', p],
    queryFn: ({ signal }) => get<Page<SupportConversationDto>>('/support/queue', { ...p, pageSize: 200 } as Record<string, string | number | string[] | undefined>, signal),
    placeholderData: keepPreviousData,
    refetchInterval: POLL_MS,
    enabled,
  });

export const useSupportSummary = (queue?: SupportQueue, enabled = true) =>
  useQuery({ queryKey: ['support', 'summary', queue ?? 'all'], queryFn: () => get<SupportSummary>('/support/summary', { queue }), refetchInterval: POLL_MS, enabled });

export const useSupportAnalytics = (p: { days: SupportAnalyticsPeriod; queue?: SupportQueue }, enabled = true) =>
  useQuery({
    queryKey: ['support', 'analytics', p.days, p.queue ?? 'all'],
    queryFn: ({ signal }) => get<SupportAnalytics>('/support/analytics', { days: p.days, queue: p.queue }, signal),
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
    enabled,
  });

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
      mutationFn: ({ id, ...body }: { id: string; queue?: SupportQueue; priority?: SupportPriority }) => patch<SupportConversationDetail | null>(`/support/conversations/${id}`, body),
      // Transferência pode tirar a conversa do alcance do time: não repõe o detalhe no cache, só invalida.
      onSuccess: () => void qc.invalidateQueries({ queryKey: ['support'] }),
    }),
  };
}

/** Atendentes que podem assumir conversas da fila (ou de qualquer fila). */
export const agentLookup =
  (queue?: SupportQueue | null) =>
  ({ q }: { q: string; cursor: string | null }) =>
    get<CursorPage<LookupOption>>('/support/agents', { q, queue: queue ?? undefined });
