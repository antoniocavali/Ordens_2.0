'use client';

import * as Popover from '@radix-ui/react-popover';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Check, ChevronsUpDown, Loader2, Search, X } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { cn } from './cn';
import { inputBase } from './field';

export interface ComboOption {
  id: string;
  label: string;
  description?: string;
  meta?: Record<string, string | null>;
}

export interface ComboPage {
  items: ComboOption[];
  nextCursor: string | null;
}

export interface AsyncComboboxProps {
  id?: string;
  value: ComboOption | null;
  onChange: (option: ComboOption | null) => void;
  /** Busca paginada no servidor. */
  fetchPage: (params: { q: string; cursor: string | null }) => Promise<ComboPage>;
  /** Chave de cache; inclua dependências (ex.: sellerId) para refazer a busca quando o pai mudar. */
  queryKey: readonly unknown[];
  placeholder?: string;
  searchPlaceholder?: string;
  disabled?: boolean;
  /** Mensagem exibida quando desabilitado por dependência (ex.: "Selecione o vendedor"). */
  disabledHint?: string;
  emptyText?: string;
  clearable?: boolean;
  'aria-invalid'?: boolean;
  'aria-describedby'?: string;
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Combobox pesquisável com debounce, paginação infinita, loading e navegação por teclado. */
export function AsyncCombobox({
  id,
  value,
  onChange,
  fetchPage,
  queryKey,
  placeholder = 'Selecionar…',
  searchPlaceholder = 'Pesquisar…',
  disabled,
  disabledHint,
  emptyText = 'Nenhum resultado encontrado',
  clearable = true,
  ...aria
}: AsyncComboboxProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [active, setActive] = useState(0);
  const q = useDebounced(search.trim(), 250);
  const listId = useId();
  const listRef = useRef<HTMLUListElement>(null);
  const sentinelRef = useRef<HTMLLIElement>(null);

  const query = useInfiniteQuery({
    queryKey: [...queryKey, q],
    queryFn: ({ pageParam }) => fetchPage({ q, cursor: pageParam }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled: open && !disabled,
    staleTime: 30_000,
  });

  const options = useMemo(() => query.data?.pages.flatMap((p) => p.items) ?? [], [query.data]);

  useEffect(() => setActive(0), [q]);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !open) return;
    const io = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting && query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage();
    });
    io.observe(el);
    return () => io.disconnect();
  }, [open, query, options.length]);

  const select = (opt: ComboOption) => {
    onChange(opt);
    setOpen(false);
    setSearch('');
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, options.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const opt = options[active];
      if (opt) select(opt);
    } else if (e.key === 'Home') {
      setActive(0);
    } else if (e.key === 'End') {
      setActive(options.length - 1);
    }
  };

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  return (
    <Popover.Root open={open} onOpenChange={(o) => !disabled && setOpen(o)}>
      <Popover.Trigger asChild disabled={disabled}>
        <button
          id={id}
          type="button"
          role="combobox"
          disabled={disabled}
          aria-disabled={disabled || undefined}
          aria-expanded={open}
          aria-controls={listId}
          aria-haspopup="listbox"
          {...aria}
          className={cn(inputBase, 'group flex h-9 items-center gap-2 text-left', !value && 'text-subtle')}
        >
          {value ? (
            <span className="min-w-0 flex-1 truncate text-text">{value.label}</span>
          ) : (
            <span className="min-w-0 flex-1 truncate">{disabled && disabledHint ? disabledHint : placeholder}</span>
          )}
          {value && clearable && !disabled ? (
            <span
              role="button"
              tabIndex={-1}
              aria-label="Limpar seleção"
              onPointerDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onChange(null);
              }}
              className="grid size-5 place-items-center rounded text-subtle opacity-0 transition hover:bg-surface-3 hover:text-text group-hover:opacity-100"
            >
              <X className="size-3.5" />
            </span>
          ) : null}
          <ChevronsUpDown className="size-4 shrink-0 text-subtle" aria-hidden />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={6}
          className="z-[70] w-[var(--radix-popover-trigger-width)] min-w-72 overflow-hidden rounded-lg bg-surface shadow-lg ring-1 ring-border data-[state=open]:animate-in data-[state=open]:fade-in data-[state=open]:zoom-in-95"
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            (e.currentTarget as HTMLElement).querySelector('input')?.focus();
          }}
        >
          <div className="flex items-center gap-2 border-b border-border/70 px-3">
            <Search className="size-4 text-subtle" aria-hidden />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder={searchPlaceholder}
              aria-controls={listId}
              aria-activedescendant={options[active] ? `${listId}-${active}` : undefined}
              className="h-10 flex-1 bg-transparent text-sm outline-none placeholder:text-subtle"
            />
            {query.isFetching ? <Loader2 className="size-4 animate-spin text-subtle" aria-label="Carregando" /> : null}
          </div>
          <ul ref={listRef} id={listId} role="listbox" className="max-h-72 overflow-y-auto p-1">
            {query.isLoading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <li key={i} className="mx-1 my-1.5 h-8 animate-pulse rounded-md bg-surface-2" aria-hidden />
              ))
            ) : query.isError ? (
              <li className="px-3 py-6 text-center text-sm text-danger">Não foi possível carregar. Tente novamente.</li>
            ) : options.length === 0 ? (
              <li className="px-3 py-6 text-center text-sm text-muted">{emptyText}</li>
            ) : (
              options.map((opt, i) => {
                const selected = value?.id === opt.id;
                return (
                  <li
                    key={opt.id}
                    id={`${listId}-${i}`}
                    data-index={i}
                    role="option"
                    aria-selected={selected}
                    onMouseEnter={() => setActive(i)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => select(opt)}
                    className={cn(
                      'flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 text-sm',
                      i === active ? 'bg-primary-soft' : 'hover:bg-surface-2',
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <div className={cn('truncate', selected && 'font-medium text-primary')}>{opt.label}</div>
                      {opt.description ? <div className="truncate text-xs text-subtle">{opt.description}</div> : null}
                    </div>
                    {selected ? <Check className="size-4 text-primary" aria-hidden /> : null}
                  </li>
                );
              })
            )}
            <li ref={sentinelRef} aria-hidden className="h-px" />
            {query.isFetchingNextPage ? <li className="py-2 text-center text-xs text-subtle">Carregando mais…</li> : null}
          </ul>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
