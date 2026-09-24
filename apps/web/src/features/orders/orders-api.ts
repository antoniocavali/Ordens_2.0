'use client';

import type {
  CursorPage,
  LookupOption,
  OrderDetail,
  OrderDraftInput,
  OrderListItem,
  OrderListQuery,
  OrdersSummary,
  OrderVersionDto,
  OrderViewHistoryItem,
  Page,
  ReleaseListItem,
  ReleaseListQuery,
  ReleasesSummary,
  TimelineEventDto,
} from '@ordens/contracts';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { get, patch, post } from '@/lib/api';

export type ListParams = Partial<Omit<OrderListQuery, 'status'>> & { status?: string[] };

export const orderKeys = {
  all: ['orders'] as const,
  list: (p: ListParams) => ['orders', 'list', p] as const,
  summary: ['orders', 'summary'] as const,
  detail: (id: string) => ['orders', 'detail', id] as const,
  timeline: (id: string) => ['orders', 'timeline', id] as const,
  versions: (id: string) => ['orders', 'versions', id] as const,
  views: (id: string) => ['orders', 'views', id] as const,
};

export function useOrders(params: ListParams) {
  return useQuery({
    queryKey: orderKeys.list(params),
    queryFn: ({ signal }) => get<Page<OrderListItem>>('/orders', params as Record<string, string>, signal),
    placeholderData: keepPreviousData,
  });
}

export const useOrdersSummary = () => useQuery({ queryKey: orderKeys.summary, queryFn: () => get<OrdersSummary>('/orders/summary') });
export const useOrder = (id: string | null) =>
  useQuery({ queryKey: orderKeys.detail(id ?? ''), queryFn: () => get<OrderDetail>(`/orders/${id}`), enabled: Boolean(id) });
export const useTimeline = (id: string | null) =>
  useQuery({ queryKey: orderKeys.timeline(id ?? ''), queryFn: () => get<TimelineEventDto[]>(`/orders/${id}/timeline`), enabled: Boolean(id) });
export const useVersions = (id: string) => useQuery({ queryKey: orderKeys.versions(id), queryFn: () => get<OrderVersionDto[]>(`/orders/${id}/versions`) });
export const useViewHistory = (id: string, enabled = true) =>
  useQuery({ queryKey: orderKeys.views(id), queryFn: () => get<OrderViewHistoryItem[]>(`/orders/${id}/view-history`), enabled });

export function useInvalidateOrders() {
  const qc = useQueryClient();
  return (detail?: OrderDetail) => {
    if (detail) qc.setQueryData(orderKeys.detail(detail.id), detail);
    void qc.invalidateQueries({ queryKey: ['orders', 'list'] });
    void qc.invalidateQueries({ queryKey: orderKeys.summary });
    if (detail) void qc.invalidateQueries({ queryKey: orderKeys.timeline(detail.id) });
  };
}

export const createOrder = (data: OrderDraftInput) => post<OrderDetail>('/orders', data);
export const updateOrder = (id: string, expectedVersion: number, expectedUpdatedAt: string, data: OrderDraftInput) =>
  patch<OrderDetail>(`/orders/${id}`, { expectedVersion, expectedUpdatedAt, data });
export const publishOrder = (id: string, expectedUpdatedAt: string) => post<OrderDetail>(`/orders/${id}/publish`, { expectedUpdatedAt });
// Portal do Comprador e Faturamento (Q41)
export const createBuyerOrder = (data: Record<string, unknown>) => post<OrderDetail>('/orders/buyer', data);
export const updateBuyerOrder = (id: string, expectedUpdatedAt: string, data: Record<string, unknown>) => patch<OrderDetail>(`/orders/buyer/${id}`, { expectedUpdatedAt, data });
export const submitOrder = (id: string, expectedUpdatedAt: string) => post<OrderDetail>(`/orders/${id}/submit`, { expectedUpdatedAt });
export const assignFarm = (id: string, body: Record<string, unknown>) => post<OrderDetail>(`/orders/${id}/billing/assign`, body);
export const suspendOrder = (id: string, expectedUpdatedAt: string, reason: string) => post<OrderDetail>(`/orders/${id}/suspend`, { expectedUpdatedAt, reason });
export const resumeOrder = (id: string, expectedUpdatedAt: string) => post<OrderDetail>(`/orders/${id}/resume`, { expectedUpdatedAt });
export const cancelOrder = (id: string, expectedUpdatedAt: string, reason: string) => post<OrderDetail>(`/orders/${id}/cancel`, { expectedUpdatedAt, reason });
export const completeOrder = (id: string, expectedUpdatedAt: string, input: { reason: string | null; acceptPendingDocuments: boolean }) =>
  post<OrderDetail>(`/orders/${id}/complete`, { expectedUpdatedAt, ...input });
export const returnToBuyer =(id: string, expectedUpdatedAt: string, reason: string) => post<OrderDetail>(`/orders/${id}/billing/return`, { expectedUpdatedAt, reason });
export const cancelBuyerOrder = (id: string, expectedUpdatedAt: string, reason: string) => post<OrderDetail>(`/orders/${id}/buyer-cancel`, { expectedUpdatedAt, reason });
export const billingPublish =(id: string, expectedUpdatedAt: string) => post<OrderDetail>(`/orders/${id}/billing/publish`, { expectedUpdatedAt });

export const requestPublishOrder =(id: string, expectedUpdatedAt: string) => post<OrderDetail>(`/orders/${id}/publish-request`, { expectedUpdatedAt });

export function useCreateRelease(orderId: string) {
  const invalidate = useInvalidateOrders();
  return useMutation({
    mutationFn: (body: { quantity: string; validUntil?: string | null; notes?: string | null; expectedVersion: number }) =>
      post<OrderDetail>(`/orders/${orderId}/releases`, body),
    onSuccess: (d) => invalidate(d),
  });
}

// ─── Liberações (chaves sob ['orders'] para o tempo real invalidar junto) ───
export type ReleaseParams = Partial<Omit<ReleaseListQuery, 'status'>> & { status?: string[] };

export function useReleases(params: ReleaseParams) {
  return useQuery({
    queryKey: ['orders', 'releases', params],
    queryFn: ({ signal }) => get<Page<ReleaseListItem>>('/orders/releases', params as Record<string, string>, signal),
    placeholderData: keepPreviousData,
  });
}

export const useReleasesSummary = () => useQuery({ queryKey: ['orders', 'releases-summary'], queryFn: () => get<ReleasesSummary>('/orders/releases/summary') });

export function useCancelRelease() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ orderId, releaseId, ...body }: { orderId: string; releaseId: string; reason: string; expectedVersion: number }) =>
      post<OrderDetail>(`/orders/${orderId}/releases/${releaseId}/cancel`, body),
    onSuccess: (d) => {
      qc.setQueryData(orderKeys.detail(d.id), d);
      void qc.invalidateQueries({ queryKey: ['orders'] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

/** Registra visualização efetiva (abertura de detalhe/quick view). A API ignora escopo Matriz. */
export const registerView = (id: string) => post<{ recorded: boolean }>(`/orders/${id}/views`);

// ─── Lookups para comboboxes ───
type LookupQuery = Record<string, string | undefined | null>;
const lookup = (path: string, extra: LookupQuery = {}) => ({ q, cursor }: { q: string; cursor: string | null }) =>
  get<CursorPage<LookupOption>>(path, { ...extra, q, cursor, limit: 20 });

export const lookups = {
  sellers: (contractId?: string | null) => lookup('/lookups/partners', { role: 'SELLER', contractId }),
  buyers: (contractId?: string | null) => lookup('/lookups/partners', { role: 'BUYER', contractId }),
  /** Parceiros com papel de transportadora: usado só para vincular um grupo de acesso do tipo Transportadora. */
  carriers: () => lookup('/lookups/partners', { role: 'CARRIER' }),
  farms: (sellerId: string) => lookup('/lookups/farms', { sellerId }),
  commodities: (contractId?: string | null) => lookup('/lookups/commodities', { contractId }),
  contracts: (filters: { sellerId?: string; buyerId?: string; commodityId?: string }) => lookup('/lookups/contracts', filters),
};

export const useUnits = () => useQuery({ queryKey: ['lookups', 'units'], queryFn: () => get<LookupOption[]>('/lookups/units'), staleTime: 5 * 60_000 });
