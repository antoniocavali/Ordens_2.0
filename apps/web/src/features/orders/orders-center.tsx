'use client';

import * as Dropdown from '@radix-ui/react-dropdown-menu';
import type { OrderListItem, OrderStatus, ViewSignal } from '@ordens/contracts';
import { Badge, Button, Card, cn, EmptyState, Input, Skeleton, Tooltip } from '@ordens/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
  type VisibilityState,
} from '@tanstack/react-table';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  BookmarkPlus,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Columns3,
  Download,
  Eye,
  EyeOff,
  Filter,
  MoreHorizontal,
  Plus,
  Rows3,
  Scale,
  Search,
  Truck,
  X,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { del, get, post } from '@/lib/api';
import { formatDate, formatMoney, formatQty, formatQtyCompact, formatRelative, formatShortDate } from '@/lib/format';
import { useCan, useMe } from '@/lib/session';
import { Farol, PriorityDot, QuantityBar, SIGNAL_OPTIONS, STATUS_OPTIONS, StatusBadge } from './indicators';
import { KpiCard } from './kpi';
import { OrderFormDrawer } from './order-form-drawer';
import { useOrder, useOrders, useOrdersSummary, type ListParams } from './orders-api';
import { QuickView } from './quick-view';
import { ReleaseDialog } from './release-dialog';

// ───────────────────────────── Estado na URL ─────────────────────────────

interface Filters {
  q: string;
  status: OrderStatus[];
  farmSignal: ViewSignal | '';
  buyerSignal: ViewSignal | '';
  sort: string;
  page: number;
  pageSize: number;
}

const DEFAULTS: Filters = { q: '', status: [], farmSignal: '', buyerSignal: '', sort: 'updatedAt:desc', page: 1, pageSize: 50 };

function useUrlFilters(): [Filters, (patch: Partial<Filters>) => void] {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const filters: Filters = {
    q: params.get('q') ?? '',
    status: params.getAll('status') as OrderStatus[],
    farmSignal: (params.get('farmSignal') ?? '') as Filters['farmSignal'],
    buyerSignal: (params.get('buyerSignal') ?? '') as Filters['buyerSignal'],
    sort: params.get('sort') ?? DEFAULTS.sort,
    page: Number(params.get('page') ?? 1),
    pageSize: Number(params.get('pageSize') ?? DEFAULTS.pageSize),
  };
  const set = useCallback(
    (patch: Partial<Filters>) => {
      const next = { ...filters, ...patch, page: patch.page ?? 1 };
      const sp = new URLSearchParams();
      if (next.q) sp.set('q', next.q);
      next.status.forEach((s) => sp.append('status', s));
      if (next.farmSignal) sp.set('farmSignal', next.farmSignal);
      if (next.buyerSignal) sp.set('buyerSignal', next.buyerSignal);
      if (next.sort !== DEFAULTS.sort) sp.set('sort', next.sort);
      if (next.page > 1) sp.set('page', String(next.page));
      if (next.pageSize !== DEFAULTS.pageSize) sp.set('pageSize', String(next.pageSize));
      for (const k of ['nova', 'ordem']) if (params.get(k)) sp.set(k, params.get(k)!);
      router.replace(`${pathname}${sp.size ? `?${sp}` : ''}`, { scroll: false });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [params, pathname, router],
  );
  return [filters, set];
}

function useLocalState<T>(key: string, initial: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(initial);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw) setValue(JSON.parse(raw) as T);
    } catch {
      /* preferências locais são opcionais */
    }
  }, [key]);
  return [
    value,
    (v: T) => {
      setValue(v);
      try {
        localStorage.setItem(key, JSON.stringify(v));
      } catch {
        /* ignore */
      }
    },
  ];
}

// ───────────────────────────── Views ─────────────────────────────

interface ViewPreset {
  id: string;
  name: string;
  state: Partial<Filters>;
  saved?: boolean;
}

const BUILTIN_VIEWS: ViewPreset[] = [
  { id: 'all', name: 'Todas', state: {} },
  { id: 'open', name: 'Abertas', state: { status: ['PUBLISHED', 'IN_PROGRESS', 'SUSPENDED'] } },
  { id: 'drafts', name: 'Rascunhos', state: { status: ['DRAFT'] } },
  { id: 'farm-pending', name: 'Não visualizadas pela Fazenda', state: { farmSignal: 'OVERDUE' } },
  { id: 'new-version', name: 'Nova versão pendente', state: { farmSignal: 'OUTDATED' } },
  { id: 'in-progress', name: 'Em execução', state: { status: ['IN_PROGRESS'] } },
];

const matchesView = (f: Filters, v: ViewPreset) =>
  (v.state.q ?? '') === f.q &&
  JSON.stringify([...(v.state.status ?? [])].sort()) === JSON.stringify([...f.status].sort()) &&
  (v.state.farmSignal ?? '') === f.farmSignal &&
  (v.state.buyerSignal ?? '') === f.buyerSignal;

// ───────────────────────────── Componente ─────────────────────────────

export function OrdersCenter() {
  const [filters, setFilters] = useUrlFilters();
  const params = useSearchParams();
  const router = useRouter();
  const can = useCan();
  const { data: me } = useMe();
  const qc = useQueryClient();
  const scope = me?.activeMembership?.scope;

  const [search, setSearch] = useState(filters.q);
  const [density, setDensity] = useLocalState<'comfortable' | 'compact'>('orders:density', 'comfortable');
  const [columnVisibility, setColumnVisibility] = useLocalState<VisibilityState>('orders:columns', { contract: false, carrier: false, value: true });
  const [rowSelection, setRowSelection] = useState<Record<string, boolean>>({});
  const [quickId, setQuickId] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [releaseId, setReleaseId] = useState<string | null>(null);
  const creating = params.get('nova') === '1';

  useEffect(() => setSearch(filters.q), [filters.q]);
  useEffect(() => {
    const t = setTimeout(() => search !== filters.q && setFilters({ q: search }), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const listParams: ListParams = {
    q: filters.q || undefined,
    status: filters.status.length ? filters.status : undefined,
    farmSignal: (filters.farmSignal || undefined) as ListParams['farmSignal'],
    buyerSignal: (filters.buyerSignal || undefined) as ListParams['buyerSignal'],
    sort: filters.sort as ListParams['sort'],
    page: filters.page,
    pageSize: filters.pageSize,
  };
  const orders = useOrders(listParams);
  const summary = useOrdersSummary();
  const editing = useOrder(editId);
  const releasing = useOrder(releaseId);

  const savedViews = useQuery({
    queryKey: ['saved-views', 'orders'],
    queryFn: () => get<{ id: string; name: string; state: Partial<Filters> }[]>('/me/saved-views', { resource: 'orders' }),
  });
  const MATRIZ_ONLY_VIEWS = ['drafts', 'farm-pending', 'new-version'];
  const views: ViewPreset[] = [
    ...BUILTIN_VIEWS.filter((v) => scope === 'MATRIZ' || !MATRIZ_ONLY_VIEWS.includes(v.id)),
    ...(savedViews.data ?? []).map((v) => ({ ...v, saved: true })),
  ];

  const saveView = async () => {
    const name = window.prompt('Nome da visualização', filters.q ? `Busca: ${filters.q}` : 'Minha visualização');
    if (!name) return;
    await post('/me/saved-views', { resource: 'orders', name, state: { q: filters.q, status: filters.status, farmSignal: filters.farmSignal, buyerSignal: filters.buyerSignal, sort: filters.sort } });
    void qc.invalidateQueries({ queryKey: ['saved-views', 'orders'] });
    toast.success('Visualização salva');
  };

  const closeCreate = () => {
    const sp = new URLSearchParams(params);
    sp.delete('nova');
    router.replace(`/ordens${sp.size ? `?${sp}` : ''}`, { scroll: false });
  };

  const sorting: SortingState = useMemo(() => {
    const [id, dir] = filters.sort.split(':');
    return [{ id: id!, desc: dir === 'desc' }];
  }, [filters.sort]);

  const columns = useMemo<ColumnDef<OrderListItem>[]>(
    () => [
      {
        id: 'select',
        size: 40,
        enableResizing: false,
        header: ({ table }) => (
          <input
            type="checkbox"
            aria-label="Selecionar todas"
            className="size-4 accent-[var(--primary)]"
            checked={table.getIsAllPageRowsSelected()}
            onChange={table.getToggleAllPageRowsSelectedHandler()}
          />
        ),
        cell: ({ row }) => (
          <input
            type="checkbox"
            aria-label={`Selecionar ${row.original.number}`}
            className="size-4 accent-[var(--primary)]"
            checked={row.getIsSelected()}
            onClick={(e) => e.stopPropagation()}
            onChange={row.getToggleSelectedHandler()}
          />
        ),
      },
      {
        id: 'number',
        header: 'OC',
        size: 138,
        enableSorting: true,
        cell: ({ row: { original: o } }) => (
          <div className="flex items-center gap-2">
            <PriorityDot priority={o.priority} />
            <div className="min-w-0">
              <Link href={`/ordens/${o.id}`} onClick={(e) => e.stopPropagation()} className="font-mono text-[13px] font-medium text-text hover:text-primary hover:underline">
                {o.number}
              </Link>
              <div className="truncate text-[11px] text-subtle">{o.externalNumber ? `ext. ${o.externalNumber}` : `v${o.version}`}</div>
            </div>
          </div>
        ),
      },
      { id: 'status', header: 'Status', size: 132, cell: ({ row }) => <StatusBadge status={row.original.status} size="sm" /> },
      {
        id: 'commodity',
        header: 'Commodity',
        size: 150,
        cell: ({ row: { original: o } }) => (
          <div className="min-w-0">
            <div className="truncate font-medium">{o.commodity?.name ?? <span className="text-subtle">—</span>}</div>
            <div className="text-[11px] text-subtle">{o.cropYear ? `Safra ${o.cropYear}` : ''}</div>
          </div>
        ),
      },
      {
        id: 'parties',
        header: 'Vendedor · Fazenda',
        size: 220,
        cell: ({ row: { original: o } }) => (
          <div className="min-w-0">
            <div className="truncate">{o.seller?.name ?? <span className="text-subtle">—</span>}</div>
            <div className="truncate text-[11px] text-subtle">
              {o.farm ? `${o.farm.name}${o.farm.city ? ` · ${o.farm.city}/${o.farm.state}` : ''}` : 'Fazenda não definida'}
            </div>
          </div>
        ),
      },
      { id: 'buyer', header: 'Comprador', size: 160, cell: ({ row: { original: o } }) => <span className="block truncate">{o.buyer?.name ?? <span className="text-subtle">—</span>}</span> },
      { id: 'contract', header: 'Contrato', size: 120, cell: ({ row: { original: o } }) => <span className="font-mono text-xs">{o.contract?.number ?? '—'}</span> },
      {
        id: 'quantity',
        header: 'Quantidade · Execução',
        size: 230,
        enableSorting: true,
        cell: ({ row: { original: o } }) => (
          <div className="min-w-0 space-y-1.5">
            <div className="flex items-baseline justify-between gap-2 tabular">
              <span className="font-medium">{formatQty(o.quantities.total, o.quantities.unit)}</span>
              <span className="text-[11px] text-subtle">lib. {formatQtyCompact(o.quantities.released)}</span>
            </div>
            <QuantityBar q={o.quantities} />
          </div>
        ),
      },
      {
        id: 'balance',
        header: 'Saldo',
        size: 100,
        cell: ({ row: { original: o } }) => <span className="block text-right tabular">{formatQty(o.quantities.balance, o.quantities.unit)}</span>,
      },
      {
        id: 'value',
        header: 'Valor',
        size: 120,
        cell: ({ row: { original: o } }) => <span className="block text-right tabular">{o.totalValue ? formatMoney(o.totalValue, o.currency, true) : '—'}</span>,
      },
      { id: 'carrier', header: 'Transportadora', size: 140, cell: ({ row: { original: o } }) => <span className="block truncate">{o.preferredCarrier?.name ?? 'A definir'}</span> },
      ...(scope !== 'BUYER'
        ? [
            {
              id: 'farmView',
              header: 'Fazenda',
              size: 104,
              cell: ({ row: { original: o } }) => (o.status === 'DRAFT' ? <span className="text-xs text-subtle">—</span> : <Farol side="Fazenda" info={o.farmView} version={o.version} compact />),
            } satisfies ColumnDef<OrderListItem>,
          ]
        : []),
      ...(scope !== 'FARM'
        ? [
            {
              id: 'buyerView',
              header: 'Comprador',
              size: 104,
              cell: ({ row: { original: o } }) => (o.status === 'DRAFT' ? <span className="text-xs text-subtle">—</span> : <Farol side="Comprador" info={o.buyerView} version={o.version} compact />),
            } satisfies ColumnDef<OrderListItem>,
          ]
        : []),
      {
        id: 'loadingStartsOn',
        header: 'Janela',
        size: 120,
        enableSorting: true,
        cell: ({ row: { original: o } }) => {
          const late = o.loadingEndsOn && o.loadingEndsOn < new Date().toISOString().slice(0, 10) && ['PUBLISHED', 'IN_PROGRESS'].includes(o.status);
          return (
            <Tooltip content={o.loadingStartsOn ? `${formatDate(o.loadingStartsOn)} até ${formatDate(o.loadingEndsOn)}` : null}>
              <span className={cn('text-[13px] tabular', late && 'font-medium text-danger')}>
                {o.loadingStartsOn ? `${formatShortDate(o.loadingStartsOn)} – ${formatShortDate(o.loadingEndsOn)}` : '—'}
              </span>
            </Tooltip>
          );
        },
      },
      {
        id: 'updatedAt',
        header: 'Atualização',
        size: 130,
        enableSorting: true,
        cell: ({ row: { original: o } }) => (
          <div className="min-w-0">
            <div className="text-[13px]">{formatRelative(o.updatedAt)}</div>
            <div className="truncate text-[11px] text-subtle">{o.updatedBy ?? ''}</div>
          </div>
        ),
      },
      {
        id: 'actions',
        size: 48,
        enableResizing: false,
        header: () => <span className="sr-only">Ações</span>,
        cell: ({ row: { original: o } }) => (
          <Dropdown.Root>
            <Dropdown.Trigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label={`Ações da ordem ${o.number}`} onClick={(e) => e.stopPropagation()}>
                <MoreHorizontal />
              </Button>
            </Dropdown.Trigger>
            <Dropdown.Portal>
              <Dropdown.Content align="end" className="z-[60] min-w-48 rounded-lg bg-surface p-1 shadow-lg ring-1 ring-border" onClick={(e) => e.stopPropagation()}>
                <MenuItem onSelect={() => setQuickId(o.id)}>Visualização rápida</MenuItem>
                <MenuItem onSelect={() => router.push(`/ordens/${o.id}`)}>Abrir detalhes</MenuItem>
                {can('order.update') && !['COMPLETED', 'CANCELLED'].includes(o.status) ? <MenuItem onSelect={() => setEditId(o.id)}>{o.status === 'DRAFT' ? 'Continuar rascunho' : 'Editar'}</MenuItem> : null}
                {can('order.release') && ['PUBLISHED', 'IN_PROGRESS'].includes(o.status) ? <MenuItem onSelect={() => setReleaseId(o.id)}>Nova liberação</MenuItem> : null}
              </Dropdown.Content>
            </Dropdown.Portal>
          </Dropdown.Root>
        ),
      },
    ],
    [scope, can, router],
  );

  const table = useReactTable({
    data: orders.data?.items ?? [],
    columns,
    getRowId: (r) => r.id,
    getCoreRowModel: getCoreRowModel(),
    manualSorting: true,
    manualPagination: true,
    enableColumnResizing: true,
    columnResizeMode: 'onChange',
    // Ordem prioriza o que o operador precisa ver sem rolar: execução e faróis antes de valores.
    state: {
      sorting,
      columnVisibility,
      rowSelection,
      columnOrder: ['select', 'number', 'status', 'commodity', 'parties', 'buyer', 'quantity', 'farmView', 'buyerView', 'loadingStartsOn', 'balance', 'value', 'contract', 'carrier', 'updatedAt', 'actions'],
    },
    onColumnVisibilityChange: (u) => setColumnVisibility(typeof u === 'function' ? u(columnVisibility) : u),
    onRowSelectionChange: setRowSelection,
    enableSortingRemoval: false,
    onSortingChange: (u) => {
      const next = typeof u === 'function' ? u(sorting) : u;
      const s = next[0];
      if (s) setFilters({ sort: `${s.id}:${s.desc ? 'desc' : 'asc'}` });
    },
    defaultColumn: { enableSorting: false, minSize: 60 },
  });

  const s = summary.data;
  const total = orders.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / filters.pageSize));
  const selected = Object.keys(rowSelection).filter((k) => rowSelection[k]);
  const activeFilterCount = filters.status.length + (filters.farmSignal ? 1 : 0) + (filters.buyerSignal ? 1 : 0);
  const rowH = density === 'compact' ? 'h-11' : 'h-[58px]';

  return (
    <div className="mx-auto flex max-w-[1800px] flex-col gap-5 px-4 py-6 sm:px-6 lg:px-8">
      {/* Cabeçalho */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Ordens de Carregamento</h1>
          <p className="mt-1 text-sm text-muted">
            {scope === 'MATRIZ' ? 'Central operacional: liberações, execução e visualização por Fazenda e Comprador.' : 'Ordens publicadas para sua organização.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Tooltip content="Exportação em background chega na fase de relatórios">
            <span>
              <Button variant="outline" disabled>
                <Download /> Exportar
              </Button>
            </span>
          </Tooltip>
          {can('order.create') ? (
            <Button onClick={() => router.push('/ordens?nova=1', { scroll: false })}>
              <Plus /> Nova Ordem
            </Button>
          ) : null}
        </div>
      </div>

      {/* Indicadores rápidos */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {!s ? (
          Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-[106px] rounded-lg" />)
        ) : (
          <>
            <KpiCard label="Abertas" value={s.open} hint={`${s.publishedToday} publicadas hoje`} icon={<ClipboardList />} active={filters.status.join() === 'PUBLISHED,IN_PROGRESS,SUSPENDED'} onClick={() => setFilters({ status: ['PUBLISHED', 'IN_PROGRESS', 'SUSPENDED'], farmSignal: '', buyerSignal: '' })} />
            <KpiCard label="Volume em aberto" value={formatQtyCompact(s.totalQty, 't')} hint={`${formatQtyCompact(s.balanceQty, 't')} de saldo`} icon={<Scale />} />
            <KpiCard label="Liberado" value={formatQtyCompact(s.releasedQty, 't')} icon={<Scale />} progress={{ value: s.releasedQty, total: s.totalQty }} />
            <KpiCard label="Carregado" value={formatQtyCompact(s.loadedQty, 't')} hint={`${formatQtyCompact(s.receivedQty, 't')} recebidas`} icon={<Truck />} tone="success" progress={{ value: s.loadedQty, total: s.totalQty }} />
            {scope === 'MATRIZ' ? (
              <>
                <KpiCard label="Fazenda não visualizou" value={s.awaitingFarmView} hint="Versão atual pendente" icon={<EyeOff />} tone="danger" active={filters.farmSignal === 'OVERDUE'} onClick={() => setFilters({ farmSignal: filters.farmSignal === 'OVERDUE' ? '' : 'OVERDUE', status: [] })} />
                <KpiCard label="Comprador não visualizou" value={s.awaitingBuyerView} hint="Versão atual pendente" icon={<Eye />} tone="warning" active={filters.buyerSignal === 'OVERDUE'} onClick={() => setFilters({ buyerSignal: filters.buyerSignal === 'OVERDUE' ? '' : 'OVERDUE', status: [] })} />
              </>
            ) : null}
          </>
        )}
      </div>

      {/* Views */}
      <div className="-mx-1 flex items-center gap-1 overflow-x-auto px-1 pb-1">
        {views.map((v) => {
          const active = matchesView(filters, v);
          return (
            <span key={v.id} className="group relative flex shrink-0">
              <button
                onClick={() => setFilters({ q: '', status: [], farmSignal: '', buyerSignal: '', ...v.state })}
                className={cn(
                  'relative h-8 rounded-full px-3.5 text-[13px] font-medium transition-colors',
                  active ? 'text-primary' : 'text-muted hover:bg-surface-2 hover:text-text',
                  v.saved && 'pr-7',
                )}
              >
                {active ? <motion.span layoutId="view-pill" className="absolute inset-0 rounded-full bg-primary-soft ring-1 ring-primary/20" transition={{ type: 'spring', stiffness: 500, damping: 40 }} /> : null}
                <span className="relative">{v.name}</span>
              </button>
              {v.saved ? (
                <button
                  aria-label={`Excluir visualização ${v.name}`}
                  className="absolute right-1.5 top-1/2 grid size-5 -translate-y-1/2 place-items-center rounded-full text-subtle opacity-0 hover:bg-surface-3 group-hover:opacity-100"
                  onClick={async () => {
                    await del(`/me/saved-views/${v.id}`);
                    void qc.invalidateQueries({ queryKey: ['saved-views', 'orders'] });
                  }}
                >
                  <X className="size-3" />
                </button>
              ) : null}
            </span>
          );
        })}
        <Button variant="ghost" size="sm" className="shrink-0 text-muted" onClick={() => void saveView()}>
          <BookmarkPlus /> Salvar view
        </Button>
      </div>

      <Card className="flex min-h-0 flex-col overflow-hidden">
        {/* Barra de ferramentas */}
        <div className="flex flex-wrap items-center gap-2 border-b border-border/70 p-3">
          <div className="relative min-w-56 flex-1 sm:max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar OC, vendedor, fazenda, contrato…" className="pl-9" aria-label="Buscar ordens" />
          </div>

          <FilterMenu
            label="Status"
            count={filters.status.length}
            options={STATUS_OPTIONS.filter((o) => scope === 'MATRIZ' || o.value !== 'DRAFT')}
            selected={filters.status}
            onChange={(status) => setFilters({ status: status as OrderStatus[] })}
          />
          {scope !== 'BUYER' ? (
            <FilterMenu label="Farol Fazenda" count={filters.farmSignal ? 1 : 0} options={SIGNAL_OPTIONS} selected={filters.farmSignal ? [filters.farmSignal] : []} single onChange={(v) => setFilters({ farmSignal: (v[0] ?? '') as ViewSignal })} />
          ) : null}
          {scope !== 'FARM' ? (
            <FilterMenu label="Farol Comprador" count={filters.buyerSignal ? 1 : 0} options={SIGNAL_OPTIONS} selected={filters.buyerSignal ? [filters.buyerSignal] : []} single onChange={(v) => setFilters({ buyerSignal: (v[0] ?? '') as ViewSignal })} />
          ) : null}
          {activeFilterCount || filters.q ? (
            <Button variant="ghost" size="sm" onClick={() => setFilters({ q: '', status: [], farmSignal: '', buyerSignal: '' })}>
              <X /> Limpar
            </Button>
          ) : null}

          <div className="ml-auto flex items-center gap-1">
            <span className="mr-2 hidden text-xs text-subtle tabular lg:inline" aria-live="polite">
              {orders.isFetching ? 'Atualizando…' : `${total.toLocaleString('pt-BR')} ordens`}
            </span>
            <Dropdown.Root>
              <Tooltip content="Colunas">
                <Dropdown.Trigger asChild>
                  <Button variant="ghost" size="icon-sm" aria-label="Escolher colunas">
                    <Columns3 />
                  </Button>
                </Dropdown.Trigger>
              </Tooltip>
              <Dropdown.Portal>
                <Dropdown.Content align="end" className="z-[60] min-w-52 rounded-lg bg-surface p-1 shadow-lg ring-1 ring-border">
                  {table
                    .getAllLeafColumns()
                    .filter((c) => !['select', 'actions', 'number'].includes(c.id))
                    .map((c) => (
                      <Dropdown.CheckboxItem
                        key={c.id}
                        checked={c.getIsVisible()}
                        onCheckedChange={(v) => c.toggleVisibility(Boolean(v))}
                        onSelect={(e) => e.preventDefault()}
                        className="flex h-8 cursor-pointer items-center gap-2 rounded-md px-2 text-sm outline-none data-[highlighted]:bg-surface-2"
                      >
                        <span className={cn('grid size-4 place-items-center rounded border', c.getIsVisible() ? 'border-primary bg-primary text-primary-fg' : 'border-border-strong')}>
                          {c.getIsVisible() ? '✓' : ''}
                        </span>
                        {typeof c.columnDef.header === 'string' ? c.columnDef.header : c.id}
                      </Dropdown.CheckboxItem>
                    ))}
                </Dropdown.Content>
              </Dropdown.Portal>
            </Dropdown.Root>
            <Tooltip content={density === 'compact' ? 'Linhas confortáveis' : 'Linhas compactas'}>
              <Button variant="ghost" size="icon-sm" aria-label="Alternar densidade" onClick={() => setDensity(density === 'compact' ? 'comfortable' : 'compact')}>
                <Rows3 />
              </Button>
            </Tooltip>
          </div>
        </div>

        {/* Tabela (desktop) */}
        <div className="relative hidden max-h-[calc(100dvh-360px)] min-h-[320px] overflow-auto md:block">
          <table className="w-full border-separate border-spacing-0 text-[13.5px]" style={{ minWidth: table.getTotalSize() }}>
            <thead className="sticky top-0 z-10">
              {table.getHeaderGroups().map((hg) => (
                <tr key={hg.id}>
                  {hg.headers.map((h) => {
                    const sortable = h.column.getCanSort();
                    const dir = h.column.getIsSorted();
                    return (
                      <th
                        key={h.id}
                        style={{ width: h.getSize() }}
                        aria-sort={dir ? (dir === 'asc' ? 'ascending' : 'descending') : undefined}
                        className="group/th relative h-10 border-b border-border bg-surface-2/95 px-3 text-left text-[11.5px] font-semibold uppercase tracking-wider text-muted backdrop-blur"
                      >
                        {sortable ? (
                          <button className="inline-flex items-center gap-1 hover:text-text" onClick={h.column.getToggleSortingHandler()}>
                            {flexRender(h.column.columnDef.header, h.getContext())}
                            {dir === 'asc' ? <ArrowUp className="size-3.5 text-primary" /> : dir === 'desc' ? <ArrowDown className="size-3.5 text-primary" /> : <ArrowUpDown className="size-3.5 opacity-40" />}
                          </button>
                        ) : (
                          flexRender(h.column.columnDef.header, h.getContext())
                        )}
                        {h.column.getCanResize() ? (
                          <span
                            onMouseDown={h.getResizeHandler()}
                            onTouchStart={h.getResizeHandler()}
                            className={cn('absolute right-0 top-2 h-6 w-1 cursor-col-resize rounded bg-border-strong opacity-0 group-hover/th:opacity-100', h.column.getIsResizing() && 'bg-primary opacity-100')}
                            aria-hidden
                          />
                        ) : null}
                      </th>
                    );
                  })}
                </tr>
              ))}
            </thead>
            <tbody>
              {orders.isLoading ? (
                Array.from({ length: 10 }).map((_, i) => (
                  <tr key={i}>
                    {table.getVisibleLeafColumns().map((c) => (
                      <td key={c.id} className={cn('border-b border-border/60 px-3', rowH)}>
                        <Skeleton className="h-4 w-full max-w-[140px]" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : table.getRowModel().rows.length === 0 ? (
                <tr>
                  <td colSpan={table.getVisibleLeafColumns().length}>
                    <EmptyState
                      icon={<Filter />}
                      title="Nenhuma ordem encontrada"
                      description={activeFilterCount || filters.q ? 'Ajuste os filtros ou a busca para ver mais resultados.' : 'Crie a primeira ordem de carregamento.'}
                      action={
                        can('order.create') && !activeFilterCount ? (
                          <Button onClick={() => router.push('/ordens?nova=1')}>
                            <Plus /> Nova Ordem
                          </Button>
                        ) : undefined
                      }
                    />
                  </td>
                </tr>
              ) : (
                table.getRowModel().rows.map((row) => (
                  <tr
                    key={row.id}
                    onClick={() => setQuickId(row.original.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') router.push(`/ordens/${row.original.id}`);
                      if (e.key === ' ') {
                        e.preventDefault();
                        setQuickId(row.original.id);
                      }
                    }}
                    tabIndex={0}
                    aria-selected={row.getIsSelected()}
                    className={cn('group cursor-pointer outline-none transition-colors hover:bg-primary-soft/35 focus-visible:bg-primary-soft/50', row.getIsSelected() && 'bg-primary-soft/40', orders.isPlaceholderData && 'opacity-60')}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <td key={cell.id} style={{ width: cell.column.getSize(), maxWidth: cell.column.getSize() }} className={cn('border-b border-border/60 px-3 align-middle', rowH)}>
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Cards (mobile) */}
        <ul className="divide-y divide-border/70 md:hidden">
          {orders.isLoading
            ? Array.from({ length: 5 }).map((_, i) => (
                <li key={i} className="p-4">
                  <Skeleton className="h-20" />
                </li>
              ))
            : orders.data?.items.map((o) => (
                <li key={o.id}>
                  <button onClick={() => setQuickId(o.id)} className="w-full space-y-2.5 p-4 text-left active:bg-surface-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-2">
                        <PriorityDot priority={o.priority} />
                        <span className="font-mono text-sm font-medium">{o.number}</span>
                      </span>
                      <StatusBadge status={o.status} size="sm" />
                    </div>
                    <div className="text-sm">
                      <span className="font-medium">{o.commodity?.name ?? '—'}</span> · {formatQty(o.quantities.total, o.quantities.unit)}
                    </div>
                    <div className="truncate text-xs text-muted">
                      {o.farm?.name ?? o.seller?.name ?? '—'} → {o.buyer?.name ?? '—'}
                    </div>
                    <QuantityBar q={o.quantities} />
                    {o.status !== 'DRAFT' ? (
                      <div className="flex gap-2">
                        {scope !== 'BUYER' ? <Farol side="Fazenda" info={o.farmView} version={o.version} compact /> : null}
                        {scope !== 'FARM' ? <Farol side="Comprador" info={o.buyerView} version={o.version} compact /> : null}
                      </div>
                    ) : null}
                  </button>
                </li>
              ))}
        </ul>

        {/* Paginação */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/70 px-4 py-2.5 text-[13px] text-muted">
          <span className="tabular">
            {total ? `${((filters.page - 1) * filters.pageSize + 1).toLocaleString('pt-BR')}–${Math.min(filters.page * filters.pageSize, total).toLocaleString('pt-BR')} de ${total.toLocaleString('pt-BR')}` : '0 resultados'}
          </span>
          <div className="flex items-center gap-2">
            <select
              aria-label="Itens por página"
              value={filters.pageSize}
              onChange={(e) => setFilters({ pageSize: Number(e.target.value) })}
              className="h-8 rounded-md bg-surface-2 px-2 text-[13px] outline-none focus:ring-2 focus:ring-ring"
            >
              {[25, 50, 100, 200].map((n) => (
                <option key={n} value={n}>
                  {n} / página
                </option>
              ))}
            </select>
            <Button variant="ghost" size="icon-sm" aria-label="Página anterior" disabled={filters.page <= 1} onClick={() => setFilters({ page: filters.page - 1 })}>
              <ChevronLeft />
            </Button>
            <span className="tabular">
              {filters.page} / {pages}
            </span>
            <Button variant="ghost" size="icon-sm" aria-label="Próxima página" disabled={filters.page >= pages} onClick={() => setFilters({ page: filters.page + 1 })}>
              <ChevronRight />
            </Button>
          </div>
        </div>
      </Card>

      {/* Barra de ações em lote */}
      <AnimatePresence>
        {selected.length ? (
          <motion.div
            initial={{ y: 40, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 40, opacity: 0 }}
            className="fixed bottom-6 left-1/2 z-40 flex -translate-x-1/2 items-center gap-3 rounded-full bg-text py-2 pl-5 pr-2 text-bg shadow-lg"
          >
            <span className="text-sm font-medium">
              {selected.length} {selected.length === 1 ? 'selecionada' : 'selecionadas'}
            </span>
            <Badge tone="neutral" size="sm" className="bg-bg/15 text-bg">
              Ações em lote nas próximas fases
            </Badge>
            <Button size="sm" variant="ghost" className="rounded-full text-bg hover:bg-bg/10 hover:text-bg" onClick={() => setRowSelection({})}>
              <X /> Limpar
            </Button>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <QuickView
        orderId={quickId}
        onClose={() => setQuickId(null)}
        onEdit={(id) => {
          setQuickId(null);
          setEditId(id);
        }}
        onRelease={(id) => {
          setQuickId(null);
          setReleaseId(id);
        }}
      />
      <OrderFormDrawer open={creating} order={null} onClose={closeCreate} onPublished={(o) => setQuickId(o.id)} />
      <OrderFormDrawer open={Boolean(editId && editing.data)} order={editing.data ?? null} onClose={() => setEditId(null)} onPublished={(o) => setQuickId(o.id)} />
      {releasing.data ? <ReleaseDialog order={releasing.data} open={Boolean(releaseId)} onOpenChange={(o) => !o && setReleaseId(null)} /> : null}
    </div>
  );
}

function MenuItem({ children, onSelect }: { children: React.ReactNode; onSelect: () => void }) {
  return (
    <Dropdown.Item onSelect={onSelect} className="flex h-8 cursor-pointer items-center rounded-md px-2.5 text-sm outline-none data-[highlighted]:bg-surface-2">
      {children}
    </Dropdown.Item>
  );
}

function FilterMenu({
  label,
  options,
  selected,
  onChange,
  count,
  single,
}: {
  label: string;
  options: { value: string; label: string }[];
  selected: string[];
  onChange: (v: string[]) => void;
  count: number;
  single?: boolean;
}) {
  return (
    <Dropdown.Root>
      <Dropdown.Trigger asChild>
        <Button variant={count ? 'soft' : 'outline'} size="sm">
          {label}
          {count ? <span className="grid size-4 place-items-center rounded-full bg-primary text-[10px] text-primary-fg">{count}</span> : null}
        </Button>
      </Dropdown.Trigger>
      <Dropdown.Portal>
        <Dropdown.Content align="start" sideOffset={6} className="z-[60] min-w-56 rounded-lg bg-surface p-1 shadow-lg ring-1 ring-border data-[state=open]:animate-in data-[state=open]:fade-in">
          {options.map((o) => {
            const on = selected.includes(o.value);
            return (
              <Dropdown.CheckboxItem
                key={o.value}
                checked={on}
                onSelect={(e) => !single && e.preventDefault()}
                onCheckedChange={() => onChange(single ? (on ? [] : [o.value]) : on ? selected.filter((v) => v !== o.value) : [...selected, o.value])}
                className="flex h-8 cursor-pointer items-center gap-2 rounded-md px-2 text-sm outline-none data-[highlighted]:bg-surface-2"
              >
                <span className={cn('grid size-4 place-items-center border text-[10px]', single ? 'rounded-full' : 'rounded', on ? 'border-primary bg-primary text-primary-fg' : 'border-border-strong')}>{on ? '✓' : ''}</span>
                {o.label}
              </Dropdown.CheckboxItem>
            );
          })}
          {selected.length ? (
            <>
              <Dropdown.Separator className="my-1 h-px bg-border" />
              <Dropdown.Item onSelect={() => onChange([])} className="flex h-8 cursor-pointer items-center rounded-md px-2 text-sm text-muted outline-none data-[highlighted]:bg-surface-2">
                Limpar filtro
              </Dropdown.Item>
            </>
          ) : null}
        </Dropdown.Content>
      </Dropdown.Portal>
    </Dropdown.Root>
  );
}
