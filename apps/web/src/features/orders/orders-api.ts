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

export function useCreateRelease(orderId: string) {
  const invalidate = useInvalidateOrders();
  return useMutation({
    mutationFn: (body: { quantity: string; validUntil?: string | null; notes?: string | null; expectedVersion: number }) =>
      post<OrderDetail>(`/orders/${orderId}/releases`, body),
    onSuccess: (d) => invalidate(d),
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
  carriers: () => lookup('/lookups/partners', { role: 'CARRIER' }),
  farms: (sellerId: string) => lookup('/lookups/farms', { sellerId }),
  commodities: (contractId?: string | null) => lookup('/lookups/commodities', { contractId }),
  contracts: (filters: { sellerId?: string; buyerId?: string; commodityId?: string }) => lookup('/lookups/contracts', filters),
};

export const useUnits = () => useQuery({ queryKey: ['lookups', 'units'], queryFn: () => get<LookupOption[]>('/lookups/units'), staleTime: 5 * 60_000 });
