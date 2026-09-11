'use client';

import type {
  AppointmentDto,
  AppointmentInput,
  AppointmentStatus,
  CursorPage,
  LoadDto,
  LoadHistoryItem,
  LoadStatus,
  LookupOption,
  OrderListItem,
  Page,
} from '@ordens/contracts';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { get, patch, post, put } from '@/lib/api';

export interface LogisticsParams {
  q?: string;
  orderId?: string;
  status?: string[];
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

const toQuery = (p: LogisticsParams) => ({ ...p, page: p.page ?? 1, pageSize: p.pageSize ?? 100 }) as Record<string, string | number | string[] | undefined>;

export const useAppointments = (p: LogisticsParams) =>
  useQuery({ queryKey: ['logistics', 'appointments', p], queryFn: ({ signal }) => get<Page<AppointmentDto>>('/appointments', toQuery(p), signal), placeholderData: keepPreviousData });

export const useLoads = (p: LogisticsParams) =>
  useQuery({ queryKey: ['logistics', 'loads', p], queryFn: ({ signal }) => get<Page<LoadDto>>('/loads', toQuery(p), signal), placeholderData: keepPreviousData });

export const useLoad = (id: string | null) =>
  useQuery({ queryKey: ['logistics', 'load', id], queryFn: () => get<LoadDto & { history: LoadHistoryItem[] }>(`/loads/${id}`), enabled: Boolean(id) });

export function useInvalidateLogistics() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ['logistics'] });
    void qc.invalidateQueries({ queryKey: ['orders'] });
  };
}

export function useAppointmentMutations() {
  const invalidate = useInvalidateLogistics();
  return {
    save: useMutation({
      mutationFn: ({ id, data }: { id: string | null; data: AppointmentInput }) => (id ? put<AppointmentDto>(`/appointments/${id}`, data) : post<AppointmentDto>('/appointments', data)),
      onSuccess: invalidate,
    }),
    transition: useMutation({
      mutationFn: ({ id, to, reason }: { id: string; to: AppointmentStatus; reason?: string | null }) => post<AppointmentDto>(`/appointments/${id}/transition`, { to, reason }),
      onSuccess: invalidate,
    }),
  };
}

export function useLoadMutations() {
  const invalidate = useInvalidateLogistics();
  return {
    update: useMutation({
      mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) => patch<LoadDto>(`/loads/${id}`, data),
      onSuccess: invalidate,
    }),
    transition: useMutation({
      mutationFn: ({ id, ...body }: { id: string; to: LoadStatus; expectedUpdatedAt: string; notes?: string | null; grossKg?: string | null; tareKg?: string | null; receivedQty?: string | null }) =>
        post<LoadDto>(`/loads/${id}/transition`, body),
      onSuccess: invalidate,
    }),
  };
}

type Fetch = (p: { q: string; cursor: string | null }) => Promise<CursorPage<LookupOption>>;

export const fleetLookups = {
  drivers:
    (carrierId?: string | null): Fetch =>
    ({ q }) =>
      get<CursorPage<LookupOption>>('/lookups/drivers', { q, carrierId }),
  vehicles:
    (kind: 'tractor' | 'trailer', carrierId?: string | null): Fetch =>
    ({ q }) =>
      get<CursorPage<LookupOption>>('/lookups/vehicles', { q, kind, carrierId }),
  /** Ordens aptas a receber agendamentos/cargas. */
  orders:
    (): Fetch =>
    async ({ q }) => {
      const page = await get<Page<OrderListItem>>('/orders', { q, status: ['PUBLISHED', 'IN_PROGRESS'], pageSize: 20 });
      return {
        nextCursor: null,
        items: page.items.map((o) => ({
          id: o.id,
          label: o.number,
          description: `${o.commodity?.name ?? '—'} · ${o.farm?.name ?? o.seller?.name ?? '—'} → ${o.buyer?.name ?? '—'}`,
          meta: {
            released: o.quantities.released,
            scheduled: o.quantities.scheduled,
            loaded: o.quantities.loaded,
            unit: o.quantities.unit,
          },
        })),
      };
    },
};
