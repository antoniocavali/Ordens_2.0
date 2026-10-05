'use client';

import type {
  CursorPage,
  LoadDto,
  LoadHistoryItem,
  LoadStatus,
  LookupOption,
  OrderListItem,
  Page,
  TransportSuggestions,
} from '@ordens/contracts';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { get, patch, post } from '@/lib/api';

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

/** A Fazenda informa a chegada do caminhão; a carga nasce daqui. */
export function useRegisterArrival() {
  const invalidate = useInvalidateLogistics();
  return useMutation({ mutationFn: (orderId: string) => post<LoadDto>('/loads/arrival', { orderId }), onSuccess: invalidate });
}

export function useLoadMutations() {
  const invalidate = useInvalidateLogistics();
  return {
    update: useMutation({
      mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) => patch<LoadDto>(`/loads/${id}`, data),
      onSuccess: invalidate,
    }),
    transition: useMutation({
      mutationFn: ({ id, ...body }: { id: string; to: LoadStatus; expectedUpdatedAt: string; notes?: string | null; grossKg?: string | null; tareKg?: string | null; receivedQty?: string | null; acceptMissingMatrizInvoice?: boolean }) =>
        post<LoadDto>(`/loads/${id}/transition`, body),
      onSuccess: invalidate,
    }),
  };
}

type Fetch = (p: { q: string; cursor: string | null }) => Promise<CursorPage<LookupOption>>;

/**
 * Sugestões dos campos digitáveis de transporte. Carregadas uma vez por formulário (cache de 5 min):
 * a lista é do grupo de quem pergunta, então é curta, e a digitação filtra no próprio datalist.
 */
export const useTransportSuggestions = () =>
  useQuery({
    queryKey: ['logistics', 'transport-suggestions'],
    queryFn: ({ signal }) => get<TransportSuggestions>('/transport/suggestions', {}, signal),
    staleTime: 5 * 60_000,
  });

export const fleetLookups = {
  /** Ordens em execução, para vincular uma ocorrência. */
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
