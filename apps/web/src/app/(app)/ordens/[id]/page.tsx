'use client';

import * as Tabs from '@radix-ui/react-tabs';
import { Badge, Button, Card, cn, EmptyState, Skeleton } from '@ordens/ui';
import { ArrowLeft, CalendarPlus, FileText, GitCommitVertical, PackageCheck, Pencil, Send } from 'lucide-react';
import Link from 'next/link';
import { Suspense, use, useEffect, useState, type ReactNode } from 'react';
import { AppointmentDrawer } from '@/features/logistics/appointment-drawer';
import { LoadsPage } from '@/features/logistics/loads-page';
import { DocumentsPage } from '@/features/fiscal/documents-page';
import { OccurrencesPage } from '@/features/fiscal/occurrences-page';
import { OrderFormDrawer } from '@/features/orders/order-form-drawer';
import { Farol, PriorityDot, QuantityBar, StatusBadge } from '@/features/orders/indicators';
import { registerView, useInvalidateOrders, useOrder, useTimeline, useVersions, useViewHistory } from '@/features/orders/orders-api';
import { ReleaseDialog } from '@/features/orders/release-dialog';
import { Timeline } from '@/features/orders/timeline';
import { UploadDropzone } from '@/features/uploads/upload-dropzone';
import { ApiRequestError } from '@/lib/api';
import { formatDate, formatDateTime, formatMoney, formatQty } from '@/lib/format';
import { useCan, useMe } from '@/lib/session';

const FIELD_LABEL: Record<string, string> = {
  quantity: 'Quantidade',
  releasedQty: 'Liberado',
  farmId: 'Fazenda',
  sellerPartnerId: 'Vendedor',
  buyerPartnerId: 'Comprador',
  loadingStartsOn: 'Início do carregamento',
  loadingEndsOn: 'Data limite',
  unitPrice: 'Preço',
  commodityId: 'Commodity',
  farmNotes: 'Observação para a Fazenda',
  buyerNotes: 'Observação para o Comprador',
  loadingInstructions: 'Instruções de carregamento',
  tolerancePct: 'Tolerância',
};

export default function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const order = useOrder(id);
  const timeline = useTimeline(id);
  const { data: me } = useMe();
  const can = useCan();
  const invalidate = useInvalidateOrders();
  const [editing, setEditing] = useState(false);
  const [releasing, setReleasing] = useState(false);
  const [scheduling, setScheduling] = useState(false);
  const scope = me?.activeMembership?.scope;

  // Abertura efetiva do detalhe = visualização (Fazenda/Comprador).
  useEffect(() => {
    if (scope && scope !== 'MATRIZ' && order.data?.id) void registerView(id).then(() => invalidate());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, order.data?.id]);

  if (order.error instanceof ApiRequestError && order.error.status === 404) {
    return (
      <EmptyState className="py-24" icon={<FileText />} title="Ordem não encontrada" description="Ela pode não existir ou não estar disponível para sua organização." action={<Button asChild variant="outline"><Link href="/ordens">Voltar às ordens</Link></Button>} />
    );
  }
  const o = order.data;
  if (!o) {
    return (
      <div className="mx-auto max-w-[1500px] space-y-4 px-4 py-6 sm:px-6 lg:px-8">
        <Skeleton className="h-16" />
        <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
          <Skeleton className="h-96" />
          <Skeleton className="h-96" />
        </div>
      </div>
    );
  }
  const unit = o.quantities.unit;

  return (
    <div className="mx-auto max-w-[1500px] space-y-5 px-4 py-6 sm:px-6 lg:px-8">
      <Link href="/ordens" className="inline-flex items-center gap-1.5 text-[13px] text-muted hover:text-text">
        <ArrowLeft className="size-4" /> Ordens de Carregamento
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-mono text-2xl font-semibold tracking-tight">{o.number}</h1>
            <StatusBadge status={o.status} />
            <Badge tone="neutral">versão {o.version}</Badge>
            <PriorityDot priority={o.priority} withLabel />
          </div>
          <p className="text-sm text-muted">
            {o.commodity?.name ?? '—'} · {formatQty(o.quantities.total, unit)} · {o.seller?.name ?? '—'} → {o.buyer?.name ?? '—'}
            {o.externalNumber ? ` · ext. ${o.externalNumber}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {o.allowedActions.includes('release') ? (
            <Button variant="soft" onClick={() => setReleasing(true)}>
              <PackageCheck /> Nova liberação
            </Button>
          ) : null}
          {o.allowedActions.includes('update') ? (
            <Button variant="outline" onClick={() => setEditing(true)}>
              <Pencil /> {o.status === 'DRAFT' ? 'Continuar rascunho' : 'Editar'}
            </Button>
          ) : null}
          {o.allowedActions.includes('publish') ? (
            <Button onClick={() => setEditing(true)}>
              <Send /> Revisar e publicar
            </Button>
          ) : null}
        </div>
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
        <Card className="overflow-hidden">
          <Tabs.Root defaultValue="resumo">
            <Tabs.List className="flex gap-1 overflow-x-auto border-b border-border/70 px-4">
              {[
                ['resumo', 'Resumo'],
                ['liberacoes', `Liberações (${o.releases.length})`],
                ...(can('load.read') ? [['cargas', 'Cargas']] : []),
                ...(can('occurrence.read') && o.status !== 'DRAFT' ? [['ocorrencias', 'Ocorrências']] : []),
                ['versoes', 'Versões'],
                ...(scope === 'MATRIZ' ? [['visualizacoes', 'Visualizações']] : []),
                ['documentos', 'Documentos'],
              ].map(([v, l]) => (
                <Tabs.Trigger key={v} value={v!} className="relative whitespace-nowrap px-3 py-3 text-[13px] font-medium text-muted outline-none transition hover:text-text data-[state=active]:text-primary data-[state=active]:after:absolute data-[state=active]:after:inset-x-2 data-[state=active]:after:bottom-0 data-[state=active]:after:h-0.5 data-[state=active]:after:rounded-full data-[state=active]:after:bg-primary">
                  {l}
                </Tabs.Trigger>
              ))}
            </Tabs.List>

            <Tabs.Content value="resumo" className="grid gap-6 p-5 sm:grid-cols-2 sm:p-6">
              <Group title="Partes">
                <Row label="Vendedor" value={o.seller?.name} />
                <Row label="Fazenda" value={o.farm ? `${o.farm.name}${o.farm.city ? ` · ${o.farm.city}/${o.farm.state}` : ''}` : null} />
                <Row label="Comprador" value={o.buyer?.name} />
                <Row label="Contrato" value={o.contract?.number} mono />
              </Group>
              <Group title="Comercial">
                <Row label="Commodity" value={o.commodity ? `${o.commodity.name}${o.cropYear ? ` · safra ${o.cropYear}` : ''}` : null} />
                <Row label="Preço" value={o.unitPrice ? `${formatMoney(o.unitPrice, o.currency)} / ${unit}` : null} />
                <Row label="Valor estimado" value={o.totalValue ? formatMoney(o.totalValue, o.currency) : null} strong />
                <Row label="Tolerância" value={`${o.tolerancePct}%`} />
              </Group>
              <Group title="Logística">
                <Row label="Janela" value={o.loadingStartsOn ? `${formatDate(o.loadingStartsOn)} até ${formatDate(o.loadingEndsOn)}` : null} />
                <Row label="Transportadora" value={o.preferredCarrier?.name ?? 'A definir'} />
                <Row label="Frete" value={o.freightMode ? `${o.freightMode}${o.freightEstimate ? ` · ${formatMoney(o.freightEstimate)}` : ''}` : null} />
                <Row label="Destino" value={[o.destinationName, o.destinationCity && `${o.destinationCity}/${o.destinationState ?? ''}`].filter(Boolean).join(' · ') || null} />
              </Group>
              <Group title="Controle">
                <Row label="Criada" value={`${formatDateTime(o.createdAt)}${o.createdBy ? ` · ${o.createdBy}` : ''}`} />
                <Row label="Publicada" value={o.publishedAt ? formatDateTime(o.publishedAt) : 'Não publicada'} />
                <Row label="Última alteração" value={`${formatDateTime(o.updatedAt)}${o.updatedBy ? ` · ${o.updatedBy}` : ''}`} />
              </Group>
              {o.loadingInstructions || o.farmNotes || o.buyerNotes || o.internalNotes ? (
                <div className="space-y-3 sm:col-span-2">
                  <Note title="Instruções de carregamento" text={o.loadingInstructions} />
                  <Note title="Observação para a Fazenda" text={o.farmNotes} />
                  <Note title="Observação para o Comprador" text={o.buyerNotes} />
                  <Note title="Observação interna (somente Matriz)" text={o.internalNotes} tone="primary" />
                </div>
              ) : null}
            </Tabs.Content>

            <Tabs.Content value="liberacoes" className="p-5 sm:p-6">
              {o.releases.length === 0 ? (
                <EmptyState icon={<PackageCheck />} title="Nenhuma liberação" description="A Matriz libera a quantidade de forma parcial conforme a operação." />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted">
                        <th className="py-2 pr-3">#</th>
                        <th className="py-2 pr-3 text-right">Quantidade</th>
                        <th className="py-2 pr-3">Validade</th>
                        <th className="py-2 pr-3">Versão</th>
                        <th className="py-2 pr-3">Status</th>
                        <th className="py-2">Registro</th>
                      </tr>
                    </thead>
                    <tbody>
                      {o.releases.map((r) => (
                        <tr key={r.id} className="border-b border-border/60">
                          <td className="py-3 pr-3 font-mono">{String(r.sequence).padStart(2, '0')}</td>
                          <td className="py-3 pr-3 text-right font-medium tabular">{formatQty(r.quantity, unit)}</td>
                          <td className="py-3 pr-3">{r.validUntil ? formatDate(r.validUntil) : '—'}</td>
                          <td className="py-3 pr-3">v{r.orderVersion}</td>
                          <td className="py-3 pr-3">
                            <Badge tone={r.status === 'ACTIVE' ? 'primary' : r.status === 'CONSUMED' ? 'success' : 'neutral'} size="sm">
                              {{ ACTIVE: 'Ativa', CONSUMED: 'Consumida', EXPIRED: 'Expirada', CANCELLED: 'Cancelada' }[r.status]}
                            </Badge>
                          </td>
                          <td className="py-3 text-xs text-muted">
                            {formatDateTime(r.createdAt)}
                            {r.createdBy ? ` · ${r.createdBy}` : ''}
                            {r.notes ? <div className="text-subtle">{r.notes}</div> : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Tabs.Content>

            <Tabs.Content value="cargas" className="space-y-4 p-5 sm:p-6">
              {can('appointment.manage') && ['PUBLISHED', 'IN_PROGRESS'].includes(o.status) ? (
                <div className="flex justify-end">
                  <Button variant="soft" size="sm" onClick={() => setScheduling(true)}>
                    <CalendarPlus /> Agendar carregamento
                  </Button>
                </div>
              ) : null}
              <Suspense>
                <LoadsPage orderId={o.id} embedded />
              </Suspense>
            </Tabs.Content>

            <Tabs.Content value="ocorrencias" className="p-5 sm:p-6">
              <OccurrencesPage embedded orderId={o.id} defaults={{ order: { id: o.id, label: o.number } }} />
            </Tabs.Content>

            <Tabs.Content value="versoes" className="p-5 sm:p-6">
              <VersionsList id={o.id} />
            </Tabs.Content>

            {scope === 'MATRIZ' ? (
              <Tabs.Content value="visualizacoes" className="p-5 sm:p-6">
                <ViewsList id={o.id} version={o.version} />
              </Tabs.Content>
            ) : null}

            <Tabs.Content value="documentos" className="p-5 sm:p-6">
              <div className="space-y-4">
                {can('document.upload') ? <UploadDropzone entityType="loading_order" entityId={o.id} showExisting={false} accept=".pdf,.jpg,.jpeg,.png,.webp,.csv,.xlsx,.zip,.xml" /> : null}
                <DocumentsPage embedded entityId={o.id} />
              </div>
            </Tabs.Content>
          </Tabs.Root>
        </Card>

        <div className="space-y-5">
          <Card className="p-5">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-subtle">Quantidades</h2>
            <div className="mt-3 text-2xl font-semibold tabular">{formatQty(o.quantities.total, unit)}</div>
            <QuantityBar q={o.quantities} className="mt-3" showLegend />
            <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-border/60 pt-4 text-sm">
              {[
                ['Liberado', o.quantities.released],
                ['Agendado', o.quantities.scheduled],
                ['Carregado', o.quantities.loaded],
                ['Em trânsito', o.quantities.inTransit],
                ['Recebido', o.quantities.received],
                ['Cancelado', o.quantities.cancelled],
              ].map(([l, v]) => (
                <div key={l} className="flex justify-between gap-2">
                  <dt className="text-muted">{l}</dt>
                  <dd className="tabular">{formatQty(v, unit)}</dd>
                </div>
              ))}
              <div className="col-span-2 mt-1 flex justify-between border-t border-border/60 pt-2 font-semibold">
                <dt>Saldo a carregar</dt>
                <dd className="tabular">{formatQty(o.quantities.balance, unit)}</dd>
              </div>
            </dl>
          </Card>

          {o.status !== 'DRAFT' ? (
            <Card className="space-y-3 p-5">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-subtle">Visualização da versão {o.version}</h2>
              <div className="flex flex-wrap gap-2">
                {scope !== 'BUYER' ? <Farol side="Fazenda" info={o.farmView} version={o.version} /> : null}
                {scope !== 'FARM' ? <Farol side="Comprador" info={o.buyerView} version={o.version} /> : null}
              </div>
            </Card>
          ) : null}

          <Card className="p-5">
            <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-subtle">Linha do tempo</h2>
            <Timeline events={timeline.data} loading={timeline.isLoading} unit={unit} />
          </Card>
        </div>
      </div>

      <OrderFormDrawer open={editing} order={o} onClose={() => setEditing(false)} />
      <ReleaseDialog order={o} open={releasing} onOpenChange={setReleasing} />
      <AppointmentDrawer
        appointment={null}
        open={scheduling}
        onClose={() => setScheduling(false)}
        defaultOrder={{
          id: o.id,
          label: o.number,
          description: `${o.commodity?.name ?? '—'} · ${o.farm?.name ?? '—'}`,
          meta: { released: o.quantities.released, scheduled: o.quantities.scheduled, loaded: o.quantities.loaded, unit },
        }}
      />
    </div>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-subtle">{title}</h3>
      <dl className="divide-y divide-border/60">{children}</dl>
    </div>
  );
}

function Row({ label, value, mono, strong }: { label: string; value: string | null | undefined; mono?: boolean; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2 text-sm">
      <dt className="shrink-0 text-muted">{label}</dt>
      <dd className={cn('truncate text-right', mono && 'font-mono text-[13px]', strong && 'font-semibold', !value && 'text-subtle')}>{value || '—'}</dd>
    </div>
  );
}

function Note({ title, text, tone }: { title: string; text: string | null; tone?: 'primary' }) {
  if (!text) return null;
  return (
    <div className={cn('rounded-lg p-3.5', tone === 'primary' ? 'bg-primary-soft/60' : 'bg-surface-2')}>
      <div className="text-xs font-medium text-muted">{title}</div>
      <p className="mt-1 whitespace-pre-wrap text-sm">{text}</p>
    </div>
  );
}

function VersionsList({ id }: { id: string }) {
  const versions = useVersions(id);
  if (versions.isLoading) return <Skeleton className="h-40" />;
  if (!versions.data?.length) return <EmptyState icon={<GitCommitVertical />} title="Sem versões" description="A versão 1 é criada na publicação. Alterações relevantes geram novas versões." />;
  return (
    <ol className="space-y-3">
      {versions.data.map((v) => (
        <li key={v.version} className="rounded-lg p-4 ring-1 ring-border/70">
          <div className="flex items-center justify-between">
            <span className="font-semibold">Versão {v.version}</span>
            <span className="text-xs text-muted">
              {formatDateTime(v.createdAt)}
              {v.createdBy ? ` · ${v.createdBy}` : ''}
            </span>
          </div>
          {v.changedFields.length ? (
            <ul className="mt-2 space-y-1 text-sm">
              {v.changedFields.map((c) => (
                <li key={c.field} className="flex flex-wrap items-center gap-2">
                  <span className="text-muted">{FIELD_LABEL[c.field] ?? c.field}:</span>
                  <span className="text-subtle line-through">{String(c.from ?? '—')}</span>→<span className="font-medium">{String(c.to ?? '—')}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-sm text-muted">Publicação inicial</p>
          )}
        </li>
      ))}
    </ol>
  );
}

function ViewsList({ id, version }: { id: string; version: number }) {
  const views = useViewHistory(id);
  if (views.isLoading) return <Skeleton className="h-40" />;
  if (!views.data?.length) return <EmptyState title="Nenhuma visualização" description="Visualizações só são registradas quando Fazenda ou Comprador abrem o detalhe da ordem." />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted">
            <th className="py-2 pr-3">Organização</th>
            <th className="py-2 pr-3">Usuário</th>
            <th className="py-2 pr-3">Versão</th>
            <th className="py-2 pr-3">Primeira</th>
            <th className="py-2 pr-3">Última</th>
            <th className="py-2 text-right">Acessos</th>
          </tr>
        </thead>
        <tbody>
          {views.data.map((v, i) => (
            <tr key={i} className="border-b border-border/60">
              <td className="py-2.5 pr-3">
                {v.organization} <span className="text-xs text-subtle">· {v.side === 'FARM' ? 'Fazenda' : 'Comprador'}</span>
              </td>
              <td className="py-2.5 pr-3">{v.user}</td>
              <td className="py-2.5 pr-3">
                <Badge tone={v.version === version ? 'success' : 'warning'} size="sm">
                  v{v.version}
                </Badge>
              </td>
              <td className="py-2.5 pr-3 text-muted">{formatDateTime(v.firstViewedAt)}</td>
              <td className="py-2.5 pr-3 text-muted">{formatDateTime(v.lastViewedAt)}</td>
              <td className="py-2.5 text-right tabular">{v.viewCount}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
