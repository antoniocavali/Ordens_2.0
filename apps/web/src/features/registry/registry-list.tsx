'use client';

import type { Page } from '@ordens/contracts';
import { Button, Card, cn, EmptyState, Input, Select, Skeleton } from '@ordens/ui';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Archive, ChevronLeft, ChevronRight, Plus, Search } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { get } from '@/lib/api';

export interface RegistryColumn<T> {
  key: string;
  header: string;
  width?: string;
  align?: 'left' | 'right';
  className?: string;
  render: (row: T) => ReactNode;
}

export interface RegistryListProps<T extends { id: string }> {
  title: string;
  description: string;
  icon: ReactNode;
  endpoint: string;
  queryKey: string;
  query?: Record<string, string | undefined>;
  columns: RegistryColumn<T>[];
  renderCard: (row: T) => ReactNode;
  searchPlaceholder: string;
  createLabel?: string;
  onCreate?: () => void;
  onOpen: (row: T) => void;
  headerExtra?: ReactNode;
  summary?: (page: Page<T> | undefined) => ReactNode;
}

const STATUS_OPTIONS = [
  { value: 'ACTIVE', label: 'Ativos' },
  { value: 'INACTIVE', label: 'Inativos' },
  { value: 'BLOCKED', label: 'Bloqueados' },
];

/** Lista padrão de cadastros: busca com debounce, filtros e paginação server-side, cards no mobile. */
export function RegistryList<T extends { id: string }>(props: RegistryListProps<T>) {
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [archived, setArchived] = useState(false);
  const [page, setPage] = useState(1);
  const pageSize = 50;

  useEffect(() => {
    const t = setTimeout(() => {
      setQ(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const params = { ...props.query, q: q || undefined, status: status || undefined, includeArchived: archived ? 'true' : undefined, page: String(page), pageSize: String(pageSize) };
  const list = useQuery({
    queryKey: ['registry', props.queryKey, params],
    queryFn: ({ signal }) => get<Page<T>>(props.endpoint, params, signal),
    placeholderData: keepPreviousData,
  });

  const total = list.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="mx-auto flex max-w-[1600px] flex-col gap-5 px-4 py-6 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <span className="grid size-11 place-items-center rounded-xl bg-primary-soft text-primary [&_svg]:size-5">{props.icon}</span>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{props.title}</h1>
            <p className="text-sm text-muted">{props.description}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {props.headerExtra}
          {props.onCreate ? (
            <Button onClick={props.onCreate}>
              <Plus /> {props.createLabel ?? 'Novo'}
            </Button>
          ) : null}
        </div>
      </div>

      {props.summary ? props.summary(list.data) : null}

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-border/70 p-3">
          <div className="relative min-w-56 flex-1 sm:max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={props.searchPlaceholder} className="pl-9" aria-label="Buscar" />
          </div>
          <Select
            aria-label="Status"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
            options={STATUS_OPTIONS}
            placeholder="Todos os status"
            className="w-44"
          />
          <Button variant={archived ? 'soft' : 'ghost'} size="sm" onClick={() => setArchived((a) => !a)} aria-pressed={archived}>
            <Archive /> Incluir arquivados
          </Button>
          <span className="ml-auto text-xs text-subtle tabular" aria-live="polite">
            {list.isFetching ? 'Atualizando…' : `${total.toLocaleString('pt-BR')} registros`}
          </span>
        </div>

        <div className="hidden overflow-x-auto md:block">
          <table className="w-full border-separate border-spacing-0 text-[13.5px]">
            <thead className="sticky top-0 z-10">
              <tr>
                {props.columns.map((c) => (
                  <th
                    key={c.key}
                    style={{ width: c.width }}
                    className={cn('h-10 border-b border-border bg-surface-2/95 px-4 text-[11.5px] font-semibold uppercase tracking-wider text-muted', c.align === 'right' ? 'text-right' : 'text-left')}
                  >
                    {c.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {list.isLoading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i}>
                    {props.columns.map((c) => (
                      <td key={c.key} className="h-14 border-b border-border/60 px-4">
                        <Skeleton className="h-4 w-full max-w-40" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : !list.data?.items.length ? (
                <tr>
                  <td colSpan={props.columns.length}>
                    <EmptyState
                      icon={props.icon}
                      title={q || status ? 'Nenhum registro encontrado' : 'Nenhum registro ainda'}
                      description={q || status ? 'Ajuste a busca ou os filtros.' : undefined}
                      action={
                        props.onCreate && !q ? (
                          <Button onClick={props.onCreate}>
                            <Plus /> {props.createLabel ?? 'Novo'}
                          </Button>
                        ) : undefined
                      }
                    />
                  </td>
                </tr>
              ) : (
                list.data.items.map((row) => (
                  <tr
                    key={row.id}
                    tabIndex={0}
                    onClick={() => props.onOpen(row)}
                    onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), props.onOpen(row))}
                    className={cn('cursor-pointer outline-none transition-colors hover:bg-primary-soft/35 focus-visible:bg-primary-soft/50', list.isPlaceholderData && 'opacity-60')}
                  >
                    {props.columns.map((c) => (
                      <td key={c.key} className={cn('h-14 border-b border-border/60 px-4 align-middle', c.align === 'right' && 'text-right', c.className)}>
                        {c.render(row)}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <ul className="divide-y divide-border/70 md:hidden">
          {list.isLoading
            ? Array.from({ length: 5 }).map((_, i) => (
                <li key={i} className="p-4">
                  <Skeleton className="h-16" />
                </li>
              ))
            : list.data?.items.map((row) => (
                <li key={row.id}>
                  <button onClick={() => props.onOpen(row)} className="w-full p-4 text-left active:bg-surface-2">
                    {props.renderCard(row)}
                  </button>
                </li>
              ))}
        </ul>

        <div className="flex items-center justify-between gap-3 border-t border-border/70 px-4 py-2.5 text-[13px] text-muted">
          <span className="tabular">
            {total ? `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} de ${total.toLocaleString('pt-BR')}` : '0 resultados'}
          </span>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon-sm" aria-label="Página anterior" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              <ChevronLeft />
            </Button>
            <span className="tabular">
              {page} / {pages}
            </span>
            <Button variant="ghost" size="icon-sm" aria-label="Próxima página" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
              <ChevronRight />
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}

export function StatusPill({ status, archived }: { status: string; archived?: boolean }) {
  if (archived) return <span className="inline-flex h-5 items-center rounded-full bg-neutral-soft px-2 text-[11px] font-medium text-muted">Arquivado</span>;
  const cfg = { ACTIVE: ['Ativo', 'bg-success-soft text-success'], INACTIVE: ['Inativo', 'bg-neutral-soft text-muted'], BLOCKED: ['Bloqueado', 'bg-danger-soft text-danger'] }[status] ?? [status, 'bg-neutral-soft text-muted'];
  return (
    <span className={cn('inline-flex h-5 items-center gap-1 rounded-full px-2 text-[11px] font-medium', cfg[1])}>
      <span className="size-1.5 rounded-full bg-current" aria-hidden />
      {cfg[0]}
    </span>
  );
}
