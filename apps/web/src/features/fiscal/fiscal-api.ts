'use client';

import type {
  CursorPage,
  DocumentDto,
  DocumentVisibility,
  InvoiceDto,
  LookupOption,
  OccurrenceDto,
  OccurrenceInput,
  OccurrenceStatus,
  Page,
} from '@ordens/contracts';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { get, patch, post, put } from '@/lib/api';

type Query = Record<string, string | number | string[] | undefined>;

export interface OccurrenceParams {
  q?: string;
  status?: string[];
  type?: string[];
  severity?: string[];
  orderId?: string;
  loadId?: string;
  page?: number;
  pageSize?: number;
}

export interface InvoiceParams {
  q?: string;
  status?: string[];
  origin?: 'FARM' | 'MATRIZ';
  orderId?: string;
  loadId?: string;
  page?: number;
  pageSize?: number;
}

export interface DocumentParams {
  q?: string;
  kind?: string[];
  entityType?: string;
  entityId?: string;
  visibility?: DocumentVisibility;
  page?: number;
  pageSize?: number;
}

const withPaging = (p: { page?: number; pageSize?: number }) => ({ ...p, page: p.page ?? 1, pageSize: p.pageSize ?? 100 }) as Query;

export const useOccurrences = (p: OccurrenceParams, enabled = true) =>
  useQuery({
    queryKey: ['fiscal', 'occurrences', p],
    queryFn: ({ signal }) => get<Page<OccurrenceDto>>('/occurrences', withPaging(p), signal),
    placeholderData: keepPreviousData,
    enabled,
  });

/** `poll`: acompanha o processamento da NF-e pelo worker logo após o envio. */
export const useInvoices = (p: InvoiceParams, opts: { enabled?: boolean; poll?: boolean } = {}) =>
  useQuery({
    queryKey: ['fiscal', 'invoices', p],
    queryFn: ({ signal }) => get<Page<InvoiceDto>>('/invoices', withPaging(p), signal),
    placeholderData: keepPreviousData,
    enabled: opts.enabled ?? true,
    refetchInterval: opts.poll ? 3000 : false,
  });

export const useDocuments = (p: DocumentParams) =>
  useQuery({
    queryKey: ['fiscal', 'documents', p],
    queryFn: ({ signal }) => get<Page<DocumentDto>>('/documents', withPaging(p), signal),
    placeholderData: keepPreviousData,
    refetchInterval: (q) => (q.state.data?.items.some((d) => d.status === 'UPLOADED' || d.status === 'PROCESSING') ? 2500 : false),
  });

export function useInvalidateFiscal() {
  const qc = useQueryClient();
  return () => {
    for (const key of ['fiscal', 'logistics', 'orders', 'uploads']) void qc.invalidateQueries({ queryKey: [key] });
  };
}

export function useOccurrenceMutations() {
  const invalidate = useInvalidateFiscal();
  return {
    save: useMutation({
      mutationFn: ({ id, data, expectedUpdatedAt }: { id: string | null; data: OccurrenceInput; expectedUpdatedAt?: string }) =>
        id ? put<OccurrenceDto>(`/occurrences/${id}`, { ...data, expectedUpdatedAt }) : post<OccurrenceDto>('/occurrences', data),
      onSuccess: invalidate,
    }),
    transition: useMutation({
      mutationFn: ({ id, ...body }: { id: string; to: OccurrenceStatus; expectedUpdatedAt: string; resolution?: string | null }) =>
        post<OccurrenceDto>(`/occurrences/${id}/transition`, body),
      onSuccess: invalidate,
    }),
  };
}

export function useInvoiceMutations() {
  const invalidate = useInvalidateFiscal();
  return {
    cancel: useMutation({
      mutationFn: ({ id, reason }: { id: string; reason: string }) => post<InvoiceDto>(`/invoices/${id}/cancel`, { reason }),
      onSuccess: invalidate,
    }),
  };
}

export function useDocumentMutations() {
  const invalidate = useInvalidateFiscal();
  return {
    visibility: useMutation({
      mutationFn: ({ id, visibility }: { id: string; visibility: DocumentVisibility }) => patch<DocumentDto>(`/documents/${id}/visibility`, { visibility }),
      onSuccess: invalidate,
    }),
  };
}

export const responsibleLookup = ({ q }: { q: string; cursor: string | null }) => get<CursorPage<LookupOption>>('/lookups/responsibles', { q });

export async function downloadDocument(uploadId: string) {
  const { url } = await get<{ url: string }>(`/uploads/${uploadId}/download`);
  window.open(url, '_blank', 'noopener');
}
