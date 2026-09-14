'use client';

import type { AuditEventDto, Page } from '@ordens/contracts';
import { Button, Card, cn, EmptyState, Input, Select, Skeleton } from '@ordens/ui';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronLeft, ChevronRight, History, ShieldOff, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Fragment, useState } from 'react';
import { roleName } from '@/features/users/roles';
import { useUsers } from '@/features/users/users-api';
import { get } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { useCan, useMe } from '@/lib/session';
import { actionLabel, AUDIT_AREAS, ENTITY_LABELS, entityHref } from './audit-labels';

const PAGE_SIZE = 50;
const HIDDEN_KEYS = new Set(['id', 'tenantId', 'createdAt', 'updatedAt']);

const show = (v: unknown): string => {
  if (v === null || v === undefined || v === '') return '—';
  if (Array.isArray(v)) return v.length ? v.map(show).join(', ') : '—';
  if (typeof v === 'object') return JSON.stringify(v);
  if (typeof v === 'boolean') return v ? 'sim' : 'não';
  return String(v);
};

/** Campos com antes/depois; para eventos só com "depois", lista os valores registrados. */
function changes(e: AuditEventDto) {
  const before = (e.before && typeof e.before === 'object' ? e.before : {}) as Record<string, unknown>;
  const after = (e.after && typeof e.after === 'object' ? e.after : {}) as Record<string, unknown>;
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((k) => !HIDDEN_KEYS.has(k));
  return keys
    .map((k) => ({ key: k, before: before[k], after: after[k] }))
    .filter((c) => !(k(c.before) === k(c.after) && e.before));
}
const k = (v: unknown) => JSON.stringify(v ?? null);

function Detail({ e }: { e: AuditEventDto }) {
  const rows = changes(e);
  const hasBefore = Boolean(e.before);
  return (
    <div className="space-y-3 bg-surface-2/50 px-4 py-4">
      {rows.length ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-120 text-[13px]">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wider text-muted">
                <th className="pb-1.5 pr-4">Campo</th>
                {hasBefore ? <th className="pb-1.5 pr-4">Antes</th> : null}
                <th className="pb-1.5">{hasBefore ? 'Depois' : 'Valor'}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.key} className="border-t border-border/60 align-top">
                  <td className="py-1.5 pr-4 font-mono text-xs text-muted">{c.key}</td>
                  {hasBefore ? <td className="py-1.5 pr-4 text-danger/90 break-all">{show(c.before)}</td> : null}
                  <td className={cn('py-1.5 break-all', hasBefore && 'text-success')}>{show(c.after)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-xs text-subtle">Sem campos registrados para este evento.</p>
      )}
      <dl className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted">
        <div>
          <dt className="inline text-subtle">Código: </dt>
          <dd className="inline font-mono">{e.action}</dd>
        </div>
        {e.ip ? (
          <div>
            <dt className="inline text-subtle">IP: </dt>
            <dd className="inline font-mono">{e.ip}</dd>
          </div>
        ) : null}
        {e.requestId ? (
          <div>
            <dt className="inline text-subtle">Requisição: </dt>
            <dd className="inline font-mono">{e.requestId}</dd>
          </div>
        ) : null}
        {e.entityId ? (
          <div>
            <dt className="inline text-subtle">Entidade: </dt>
            <dd className="inline font-mono">{e.entityId}</dd>
          </div>
        ) : null}
      </dl>
    </div>
  );
}

/** Trilha de auditoria do tenant: quem fez o quê, quando e o que mudou (somente leitura, append-only). */
export function AuditPage() {
  const can = useCan();
  const { data: me } = useMe();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const allowed = can('audit.read');

  const area = AUDIT_AREAS.find((a) => a.key === params.get('area'));
  const actorUserId = params.get('autor') ?? '';
  const from = params.get('de') ?? '';
  const to = params.get('ate') ?? '';
  const entityType = params.get('entidade') ?? '';
  const entityId = params.get('id') ?? '';
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    setPage(1);
    router.replace(next.size ? `${pathname}?${next}` : pathname, { scroll: false });
  };

  const query = {
    page,
    pageSize: PAGE_SIZE,
    action: area?.action,
    entityType: entityType || area?.entityType,
    entityId: entityId || undefined,
    actorUserId: actorUserId || undefined,
    // Datas locais do filtro → intervalo do dia inteiro em ISO.
    from: from ? new Date(`${from}T00:00:00`).toISOString() : undefined,
    to: to ? new Date(`${to}T23:59:59.999`).toISOString() : undefined,
  };
  const list = useQuery({
    queryKey: ['audit', query],
    queryFn: ({ signal }) => get<Page<AuditEventDto>>('/audit', query as unknown as Record<string, string | number | undefined>, signal),
    placeholderData: keepPreviousData,
    enabled: allowed,
  });
  const users = useUsers({ page: 1, pageSize: 200 });

  if (me && !allowed) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16">
        <EmptyState icon={<ShieldOff />} title="Sem acesso à auditoria" description="Somente administradores e gestores consultam a trilha de auditoria." />
      </div>
    );
  }

  const items = list.data?.items ?? [];
  const total = list.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const actors = [...new Map((users.data?.items ?? []).map((u) => [u.userId, u.name])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const filtered = Boolean(area || actorUserId || from || to || entityId);

  return (
    <div className="mx-auto flex max-w-[1600px] flex-col gap-5 px-4 py-6 sm:px-6 lg:px-8">
      <div className="flex items-center gap-3.5">
        <span className="grid size-11 place-items-center rounded-xl bg-primary-soft text-primary">
          <History className="size-5" />
        </span>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Auditoria</h1>
          <p className="text-sm text-muted">Quem fez o quê e quando. Os registros não podem ser alterados nem apagados.</p>
        </div>
      </div>

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-end gap-2 border-b border-border/70 p-3">
          <Select
            aria-label="Área"
            value={area?.key ?? ''}
            onChange={(e) => setParam('area', e.target.value || null)}
            placeholder="Todas as áreas"
            options={AUDIT_AREAS.map((a) => ({ value: a.key, label: a.label }))}
            className="w-52"
          />
          <Select
            aria-label="Autor"
            value={actorUserId}
            onChange={(e) => setParam('autor', e.target.value || null)}
            placeholder="Qualquer autor"
            options={actors.map(([id, name]) => ({ value: id, label: name }))}
            className="w-56"
          />
          <label className="flex items-center gap-1.5 text-xs text-muted">
            De
            <Input type="date" aria-label="Data inicial" value={from} onChange={(e) => setParam('de', e.target.value || null)} className="w-40" />
          </label>
          <label className="flex items-center gap-1.5 text-xs text-muted">
            até
            <Input type="date" aria-label="Data final" value={to} onChange={(e) => setParam('ate', e.target.value || null)} className="w-40" />
          </label>
          {entityId ? (
            <span className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary-soft px-2.5 text-xs font-medium text-primary">
              {ENTITY_LABELS[entityType] ?? 'Entidade'} específica
              <button aria-label="Remover filtro de entidade" onClick={() => router.replace(pathname)} className="hover:text-text">
                <X className="size-3.5" />
              </button>
            </span>
          ) : null}
          {filtered ? (
            <Button variant="ghost" size="sm" onClick={() => router.replace(pathname)}>
              Limpar filtros
            </Button>
          ) : null}
          <span className="ml-auto self-center text-xs text-subtle tabular" aria-live="polite">
            {list.isFetching ? 'Atualizando…' : `${total.toLocaleString('pt-BR')} eventos`}
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-200 border-separate border-spacing-0 text-[13.5px]">
            <thead>
              <tr className="text-left text-[11.5px] font-semibold uppercase tracking-wider text-muted">
                {['Quando', 'Autor', 'Ação', 'Entidade', ''].map((h, i) => (
                  <th key={i} className="h-10 border-b border-border bg-surface-2/95 px-4">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {list.isLoading || !me ? (
                Array.from({ length: 10 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: 5 }).map((__, j) => (
                      <td key={j} className="h-12 border-b border-border/60 px-4">
                        <Skeleton className="h-4 w-full max-w-40" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : !items.length ? (
                <tr>
                  <td colSpan={5}>
                    <EmptyState icon={<History />} title={filtered ? 'Nenhum evento com esses filtros' : 'Nenhum evento registrado'} description={filtered ? 'Ajuste a área, o autor ou o período.' : undefined} />
                  </td>
                </tr>
              ) : (
                items.map((e) => {
                  const expanded = open === e.id;
                  const href = entityHref(e.entityType, e.entityId);
                  const entityText = e.entityLabel ?? ENTITY_LABELS[e.entityType] ?? e.entityType;
                  return (
                    <Fragment key={e.id}>
                      <tr className={cn('cursor-pointer transition-colors hover:bg-primary-soft/30', expanded && 'bg-primary-soft/30', list.isPlaceholderData && 'opacity-60')} onClick={() => setOpen(expanded ? null : e.id)}>
                        <td className="h-12 whitespace-nowrap border-b border-border/60 px-4 text-muted tabular">{formatDateTime(e.occurredAt)}</td>
                        <td className="border-b border-border/60 px-4">
                          <div className="font-medium">{e.actor?.name ?? 'Sistema'}</div>
                          {e.actorRole ? <div className="text-xs text-subtle">{e.actorRole.split(',').map(roleName).join(', ')}</div> : null}
                        </td>
                        <td className="border-b border-border/60 px-4">{actionLabel(e.action)}</td>
                        <td className="border-b border-border/60 px-4">
                          {href ? (
                            <Link href={href} onClick={(ev) => ev.stopPropagation()} className="text-primary hover:underline">
                              {entityText}
                            </Link>
                          ) : (
                            <span>{entityText}</span>
                          )}
                          {e.entityLabel ? <div className="text-xs text-subtle">{ENTITY_LABELS[e.entityType] ?? e.entityType}</div> : null}
                        </td>
                        <td className="w-10 border-b border-border/60 px-2">
                          <button aria-label={expanded ? 'Ocultar detalhes' : 'Ver detalhes'} aria-expanded={expanded} className="grid size-8 place-items-center rounded-md text-muted hover:bg-surface-2">
                            <ChevronDown className={cn('size-4 transition-transform', expanded && 'rotate-180')} />
                          </button>
                        </td>
                      </tr>
                      {expanded ? (
                        <tr>
                          <td colSpan={5} className="border-b border-border/60 p-0">
                            <Detail e={e} />
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-border/70 px-4 py-2.5 text-[13px] text-muted">
          <span className="tabular">{total ? `${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, total)} de ${total.toLocaleString('pt-BR')}` : '0 resultados'}</span>
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
