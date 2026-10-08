'use client';

import * as Tabs from '@radix-ui/react-tabs';
import { Badge, Button, Card, cn, EmptyState, Skeleton } from '@ordens/ui';
import { ArrowLeft, ArrowRight, CheckCircle2, FileText, GitCommitVertical, Hourglass, PauseCircle, Pencil, PlayCircle, Send, Sprout, Trash2, Truck, Undo2, XCircle } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, use, useEffect, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { LoadsPage } from '@/features/logistics/loads-page';
import { loadActionLabel } from '@/features/logistics/load-drawer';
import { LoadHolderBanner } from '@/features/logistics/load-holder';
import { useLoadMutations, useLoads, useRegisterArrival } from '@/features/logistics/logistics-api';
import { DocumentsPage } from '@/features/fiscal/documents-page';
import { OccurrencesPage } from '@/features/fiscal/occurrences-page';
import { OrderFormDrawer } from '@/features/orders/order-form-drawer';
import { Farol, PriorityDot, QuantityBar, StatusBadge } from '@/features/orders/indicators';
import type { OrderDetail } from '@ordens/contracts';
import { AssignFarmDrawer } from '@/features/orders/assign-farm-drawer';
import { BuyerOrderDrawer } from '@/features/orders/buyer-order-drawer';
import { ReasonDialog } from '@/features/logistics/reason-dialog';
import {
  billingPublish,
  cancelBuyerOrder,
  cancelOrder,
  completeOrder,
  deleteOrder,
  resumeOrder,
  returnToBuyer,
  suspendOrder,
  registerView,
  requestPublishOrder,
  submitOrder,
  useInvalidateOrders,
  useOrder,
  useTimeline,
  useVersions,
  useViewHistory,
} from '@/features/orders/orders-api';
import { CompleteOrderDialog } from '@/features/orders/complete-order-dialog';
import { useNoDestinationConfirm } from '@/features/orders/destination-guard';
import { Timeline } from '@/features/orders/timeline';
import { UploadDropzone } from '@/features/uploads/upload-dropzone';
import { ApiRequestError } from '@/lib/api';
import { formatDate, formatDateTime, formatMoney, formatQty } from '@/lib/format';
import { useCan, useMe } from '@/lib/session';
import { PageLoading } from '@/components/shell/page-loading';

type ReasonAction = 'return' | 'cancel' | 'suspend' | 'order_cancel';

const REASON_ACTIONS: Record<ReasonAction, { title: string; description: string; done: (n: string) => string }> = {
  return: {
    title: 'Devolver ao Comprador',
    description: 'A solicitação volta a rascunho para o Comprador ajustar e reenviar. Vendedor, fazenda, contrato e dados internos definidos na análise são descartados.',
    done: (n) => `Solicitação ${n} devolvida ao Comprador`,
  },
  cancel: {
    title: 'Cancelar solicitação',
    description: 'A solicitação é encerrada e não será analisada pelo Faturamento. Esta ação não pode ser desfeita.',
    done: (n) => `Solicitação ${n} cancelada`,
  },
  suspend: {
    title: 'Suspender ordem',
    description: 'Novas chegadas de caminhão ficam bloqueadas até a retomada. Cargas em andamento continuam. Fazenda e Comprador são avisados com o motivo.',
    done: (n) => `Ordem ${n} suspensa`,
  },
  order_cancel: {
    title: 'Cancelar ordem',
    description: 'Exige que não haja carga em andamento. O saldo não carregado fica como cancelado. Esta ação não pode ser desfeita.',
    done: (n) => `Ordem ${n} cancelada`,
  },
};

const FIELD_LABEL: Record<string, string> = {
  quantity: 'Quantidade',
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

const fieldValue = (v: unknown) => (v === true ? 'Sim' : v === false ? 'Não' : String(v ?? '—'));

export default function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const order = useOrder(id);
  const timeline = useTimeline(id);
  const { data: me } = useMe();
  const can = useCan();
  const invalidate = useInvalidateOrders();
  const [editing, setEditing] = useState(false);
  const router = useRouter();
  const search = useSearchParams();
  // `?carga=` (links de documentos e avisos) já abre na aba das cargas.
  const [tab, setTab] = useState(search.get('carga') ? 'cargas' : 'resumo');
  const arrival = useRegisterArrival();

  // Próxima etapa no topo da ordem: a carga mais antiga em andamento que tenha um passo ao alcance de
  // quem está olhando. Quem acompanha várias ordens (Matriz, principalmente) vê ali o que falta fazer
  // sem precisar abrir a aba de cargas.
  const loads = useLoads({ orderId: id, pageSize: 200 });
  const { transition: moveLoad } = useLoadMutations();
  const nextStep = (loads.data?.items ?? [])
    .filter((l) => !['COMPLETED', 'CANCELLED'].includes(l.status))
    .sort((a, b) => a.number.localeCompare(b.number))
    .flatMap((l) => {
      const to = l.allowedTransitions.find((t) => t !== 'CANCELLED');
      return to ? [{ load: l, to }] : [];
    })[0];
  // Sem passo ao alcance de quem olha, a ordem diz com quem a carga está — é o que mostra à Fazenda que
  // a parte dela terminou depois de concluir a validação fiscal.
  const waitingLoad = nextStep
    ? undefined
    : (loads.data?.items ?? []).filter((l) => !['COMPLETED', 'CANCELLED'].includes(l.status)).sort((a, b) => a.number.localeCompare(b.number))[0];
  const openLoad = (loadId: string) => {
    setTab('cargas');
    router.replace(`/ordens/${id}?carga=${loadId}`, { scroll: false });
  };
  const runNextStep = async () => {
    if (!nextStep) return;
    const { load, to } = nextStep;
    // Etapas que pedem dados ou conferência abrem a carga no ponto certo; as demais andam com um clique.
    const needsScreen =
      (to === 'LOADED' && !(load.grossKg && load.tareKg)) ||
      (to === 'FARM_INVOICED' && !load.fiscalChecklist?.ready) ||
      (to === 'MATRIZ_INVOICED' && !load.matrizChecklist?.ready);
    if (needsScreen) return openLoad(load.id);
    try {
      await moveLoad.mutateAsync({ id: load.id, to, expectedUpdatedAt: load.updatedAt });
      if (to === 'FARM_INVOICED') toast.success('Etapa da Fazenda concluída', { description: `Carga ${load.number} enviada para o faturamento da Matriz.` });
      else toast.success(`Carga ${load.number}: ${loadActionLabel(to)}`);
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : 'Não foi possível avançar a carga.');
      openLoad(load.id);
    }
  };
  const registerArrival = async () => {
    try {
      const load = await arrival.mutateAsync(id);
      toast.success(`Chegada registrada: carga ${load.number}`, { description: 'Aguardando carregamento.' });
      setTab('cargas');
      router.replace(`/ordens/${id}?carga=${load.id}`, { scroll: false });
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : 'Não foi possível registrar a chegada.');
    }
  };
  const [requesting, setRequesting] = useState(false);
  const [buyerEditing, setBuyerEditing] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [reasonAction, setReasonAction] = useState<ReasonAction | null>(null);
  const [completing, setCompleting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const removeOrder = async (updatedAt: string, reason: string) => {
    setDeleteBusy(true);
    try {
      const d = await deleteOrder(id, updatedAt, reason);
      toast.success(`Ordem ${d.number} excluída`);
      invalidate();
      router.replace('/ordens');
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : 'Não foi possível excluir a ordem.');
      setDeleteBusy(false);
    }
  };
  const [confirmDestination, destinationDialog] = useNoDestinationConfirm('Continuar sem destino');
  const [acting, setActing] = useState<'submit' | 'publish' | 'reason' | 'resume' | 'complete' | null>(null);
  const act = async (kind: 'submit' | 'publish' | 'reason' | 'resume' | 'complete', fn: () => Promise<OrderDetail>) => {
    setActing(kind);
    try {
      invalidate(await fn());
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : 'Não foi possível concluir a ação.');
    } finally {
      setActing(null);
    }
  };
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
          {o.allowedActions.includes('register_arrival') ? (
            <Button variant={nextStep ? 'outline' : undefined} onClick={() => void registerArrival()} loading={arrival.isPending}>
              <Truck /> Informar chegada do caminhão
            </Button>
          ) : null}
          {nextStep ? (
            <Button onClick={() => void runNextStep()} loading={moveLoad.isPending} title={`Carga ${nextStep.load.number}`}>
              <ArrowRight /> {loadActionLabel(nextStep.to)}
              <span className="font-mono text-xs opacity-80">{nextStep.load.number.split('-').pop()}</span>
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
          {o.allowedActions.includes('request_publish') ? (
            <Button
              variant={o.workflow?.publishRequestedAt ? 'outline' : undefined}
              loading={requesting}
              onClick={async () => {
                setRequesting(true);
                try {
                  const d = await requestPublishOrder(o.id, o.updatedAt);
                  invalidate(d);
                  toast.success('Publicação solicitada', { description: 'Quem pode publicar foi avisado.' });
                } catch (err) {
                  toast.error(err instanceof ApiRequestError ? err.message : 'Não foi possível solicitar a publicação.');
                } finally {
                  setRequesting(false);
                }
              }}
            >
              <Send /> {o.workflow?.publishRequestedAt ? 'Solicitar de novo' : 'Solicitar publicação'}
            </Button>
          ) : null}
          {o.allowedActions.includes('buyer_edit') ? (
            <Button variant="outline" onClick={() => setBuyerEditing(true)}>
              <Pencil /> Editar solicitação
            </Button>
          ) : null}
          {o.allowedActions.includes('submit') ? (
            <Button
              loading={acting === 'submit'}
              onClick={() =>
                confirmDestination(Boolean(o.destinationName?.trim()), () => void act('submit', async () => {
                  const d = await submitOrder(o.id, o.updatedAt);
                  toast.success(`Solicitação ${d.number} enviada ao Faturamento`, { description: 'A Matriz vai definir a fazenda e publicar a ordem.' });
                  return d;
                }))
              }
            >
              <Send /> Enviar ao Faturamento
            </Button>
          ) : null}
          {o.allowedActions.includes('assign_farm') ? (
            <Button variant={o.allowedActions.includes('billing_publish') ? 'outline' : undefined} onClick={() => setAssigning(true)}>
              <Sprout /> {o.farm ? 'Revisar fazenda' : 'Definir fazenda'}
            </Button>
          ) : null}
          {o.allowedActions.includes('billing_publish') ? (
            <Button
              loading={acting === 'publish'}
              onClick={() =>
                confirmDestination(Boolean(o.destinationName?.trim()), () => void act('publish', async () => {
                  const d = await billingPublish(o.id, o.updatedAt);
                  toast.success(`Ordem ${d.number} publicada para a Fazenda`, { description: `${d.farm?.name ?? 'Fazenda'} foi notificada.` });
                  return d;
                }))
              }
            >
              <Send /> Publicar para a Fazenda
            </Button>
          ) : null}
          {o.allowedActions.includes('return_to_buyer') ? (
            <Button variant="outline" onClick={() => setReasonAction('return')}>
              <Undo2 /> Devolver ao Comprador
            </Button>
          ) : null}
          {o.allowedActions.includes('suspend') ? (
            <Button variant="outline" onClick={() => setReasonAction('suspend')}>
              <PauseCircle /> Suspender
            </Button>
          ) : null}
          {o.allowedActions.includes('resume') ? (
            <Button
              loading={acting === 'resume'}
              onClick={() =>
                act('resume', async () => {
                  const d = await resumeOrder(o.id, o.updatedAt);
                  toast.success(`Ordem ${d.number} retomada`, { description: 'Fazenda e Comprador foram avisados.' });
                  return d;
                })
              }
            >
              <PlayCircle /> Retomar ordem
            </Button>
          ) : null}
          {o.allowedActions.includes('complete') ? (
            <Button variant="outline" onClick={() => setCompleting(true)}>
              <CheckCircle2 /> Concluir ordem
            </Button>
          ) : null}
          {o.allowedActions.includes('cancel') ? (
            <Button variant="ghost" onClick={() => setReasonAction('order_cancel')}>
              <XCircle /> Cancelar ordem
            </Button>
          ) : null}
          {o.allowedActions.includes('buyer_cancel') ? (
            <Button variant="ghost" onClick={() => setReasonAction('cancel')}>
              <XCircle /> Cancelar solicitação
            </Button>
          ) : null}
          {o.allowedActions.includes('delete') ? (
            <Button variant="ghost" className="text-danger hover:text-danger" onClick={() => setDeleting(true)}>
              <Trash2 /> Excluir
            </Button>
          ) : null}
        </div>
      </div>

      {waitingLoad ? <LoadHolderBanner status={waitingLoad.status} scope={scope} loadNumber={waitingLoad.number} /> : null}

      {o.status === 'DRAFT' && o.workflow && (o.workflow.publishRequestedAt || o.workflow.blockedByFourEyes) ? (
        <div role="status" className="flex flex-wrap items-center gap-2 rounded-lg bg-warning-soft/50 px-4 py-3 text-sm ring-1 ring-warning/20">
          <Send className="size-4 text-warning" />
          {o.workflow.publishRequestedAt ? (
            <span>
              <strong>Publicação solicitada</strong> por {o.workflow.publishRequestedBy ?? 'usuário da Matriz'} em {formatDateTime(o.workflow.publishRequestedAt)}.
            </span>
          ) : null}
          {o.workflow.blockedByFourEyes ? <span className="text-muted">Dupla checagem ativa: como você fez a última alteração, outra pessoa precisa publicar.</span> : null}
        </div>
      ) : null}

      {o.status === 'DRAFT' && o.returnedAt ? (
        <div role="status" className="flex flex-wrap items-center gap-2 rounded-lg bg-danger-soft/40 px-4 py-3 text-sm ring-1 ring-danger/20">
          <Undo2 className="size-4 text-danger" />
          <span>
            <strong>Devolvida pelo Faturamento</strong>
            {` em ${formatDateTime(o.returnedAt)}${o.returnedBy ? ` por ${o.returnedBy}` : ''}`}.
          </span>
          <span className="text-muted">Motivo: {o.returnReason}</span>
        </div>
      ) : null}
      {o.status === 'SUSPENDED' && o.suspendReason ? (
        <div role="status" className="flex flex-wrap items-center gap-2 rounded-lg bg-warning-soft/50 px-4 py-3 text-sm ring-1 ring-warning/20">
          <PauseCircle className="size-4 text-warning" />
          <span>
            <strong>Ordem suspensa</strong>
            {o.suspendedAt ? ` em ${formatDateTime(o.suspendedAt)}` : ''}: sem novas chegadas de caminhão até a retomada.
          </span>
          <span className="text-muted">Motivo: {o.suspendReason}</span>
        </div>
      ) : null}
      {o.status === 'CANCELLED' && o.cancelReason ? (
        <div role="status" className="flex flex-wrap items-center gap-2 rounded-lg bg-surface-2 px-4 py-3 text-sm ring-1 ring-border">
          <XCircle className="size-4 text-muted" />
          <span>
            <strong>{o.publishedAt ? 'Ordem cancelada' : 'Solicitação cancelada'}</strong>
            {o.cancelledAt ? ` em ${formatDateTime(o.cancelledAt)}` : ''}.
          </span>
          <span className="text-muted">Motivo: {o.cancelReason}</span>
        </div>
      ) : null}
      {o.status === 'PENDING_BILLING' ? (
        <div role="status" className="flex flex-wrap items-center gap-2 rounded-lg bg-warning-soft/50 px-4 py-3 text-sm ring-1 ring-warning/20">
          <Hourglass className="size-4 text-warning" />
          <span>
            <strong>Aguardando faturamento</strong>
            {o.submittedAt ? ` · enviada por ${o.submittedBy ?? 'Comprador'} em ${formatDateTime(o.submittedAt)}` : ''}.
          </span>
          <span className="text-muted">
            {scope === 'BUYER'
              ? 'A Matriz vai definir a fazenda e publicar a ordem. A solicitação não pode mais ser alterada.'
              : o.farm
                ? `Fazenda definida: ${o.farm.name}. Confira contrato e saldo e publique para a Fazenda.`
                : 'Defina vendedor e fazenda, confira contrato e saldo e publique para a Fazenda.'}
          </span>
        </div>
      ) : null}

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
        <Card className="overflow-hidden">
          <Tabs.Root value={tab} onValueChange={setTab}>
            <Tabs.List className="flex gap-1 overflow-x-auto border-b border-border/70 px-4">
              {[
                ['resumo', 'Resumo'],
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
                <Row label="Contrato" value={o.contractNumber} mono />
              </Group>
              <Group title="Comercial">
                <Row label="Commodity" value={o.commodity ? `${o.commodity.name}${o.cropYear ? ` · safra ${o.cropYear}` : ''}` : null} />
                <Row label="Preço" value={o.unitPrice ? `${formatMoney(o.unitPrice, o.currency)} / ${unit}` : null} />
                <Row label="Valor estimado" value={o.totalValue ? formatMoney(o.totalValue, o.currency) : null} strong />
                <Row label="Tolerância" value={`${o.tolerancePct}%`} />
              </Group>
              <Group title="Logística">
                <Row label="Janela" value={o.loadingStartsOn ? `${formatDate(o.loadingStartsOn)} até ${formatDate(o.loadingEndsOn)}` : null} />
                <Row label="Transportadora" value={o.transport.carrierName ?? 'A definir'} />
                <Row label="Motorista" value={o.transport.driverName} />
                <Row label="Veículos" value={o.transport.plates.join(' · ') || null} />
                <Row label="Local de carregamento" value={o.loadingLocationName} />
                <Row label="Frete" value={o.freightMode ? `${o.freightMode}${o.freightEstimate ? ` · ${formatMoney(o.freightEstimate)}` : ''}` : null} />
                {o.completedAt ? <Row label="Concluída em" value={`${formatDateTime(o.completedAt)}${o.completedBy ? ` · ${o.completedBy}` : ''}`} /> : null}
                {o.completionReason ? <Row label="Motivo da conclusão" value={o.completionReason} /> : null}
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

            <Tabs.Content value="cargas" className="space-y-4 p-5 sm:p-6">
              <Suspense fallback={<PageLoading />}>
                <LoadsPage orderId={o.id} />
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
                ['Carregado', o.quantities.loaded],
                ['Liberado para trânsito', o.quantities.received],
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
      <BuyerOrderDrawer open={buyerEditing} order={o} onClose={() => setBuyerEditing(false)} />
      {o.allowedActions.includes('assign_farm') ? <AssignFarmDrawer open={assigning} order={o} onClose={() => setAssigning(false)} /> : null}
      {destinationDialog}
      {completing ? (
        <CompleteOrderDialog
          order={o}
          loading={acting === 'complete'}
          onCancel={() => setCompleting(false)}
          onConfirm={(input) =>
            void act('complete', async () => {
              const d = await completeOrder(o.id, o.updatedAt, input);
              toast.success(`Ordem ${d.number} concluída`, { description: 'Fazenda e Comprador foram avisados.' });
              setCompleting(false);
              return d;
            })
          }
        />
      ) : null}
      {deleting ? (
        <ReasonDialog
          open
          title={o.status === 'DRAFT' ? 'Excluir rascunho' : 'Excluir ordem'}
          description="A ordem some de todas as telas, junto com as cargas, notas fiscais, ocorrências e anexos dela. Não há como desfazer. O motivo e quem excluiu ficam na auditoria. Para apenas encerrar a ordem mantendo o histórico, use Cancelar."
          confirmLabel="Excluir definitivamente"
          confirmText={o.number}
          loading={deleteBusy}
          onCancel={() => setDeleting(false)}
          onConfirm={(reason) => void removeOrder(o.updatedAt, reason)}
        />
      ) : null}
      {reasonAction ? (
        <ReasonDialog
          open
          title={REASON_ACTIONS[reasonAction].title}
          description={REASON_ACTIONS[reasonAction].description}
          confirmLabel={REASON_ACTIONS[reasonAction].title}
          tone={reasonAction === 'return' ? 'primary' : 'danger'}
          loading={acting === 'reason'}
          onCancel={() => setReasonAction(null)}
          onConfirm={(reason) =>
            void act('reason', async () => {
              const run = {
                return: returnToBuyer,
                cancel: cancelBuyerOrder,
                suspend: suspendOrder,
                order_cancel: cancelOrder,
              }[reasonAction];
              const d = await run(o.id, o.updatedAt, reason);
              toast.success(REASON_ACTIONS[reasonAction].done(d.number));
              setReasonAction(null);
              return d;
            })
          }
        />
      ) : null}
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
                  <span className="text-subtle line-through">{fieldValue(c.from)}</span>→<span className="font-medium">{fieldValue(c.to)}</span>
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
