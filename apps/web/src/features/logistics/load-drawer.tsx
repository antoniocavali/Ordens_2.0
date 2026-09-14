'use client';

import { LOAD_STATUS_LABELS, type LoadStatus } from '@ordens/contracts';
import { Button, Card, Drawer, Field, Input, Skeleton, Textarea } from '@ordens/ui';
import { AlertTriangle, ArrowRight, Check, XCircle } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { toast } from 'sonner';
import { FormSection, handleSaveError, span, Stat } from '@/features/registry/form-utils';
import { ApiRequestError } from '@/lib/api';
import { subDec } from '@/lib/decimal';
import { formatDate, formatDateTime, formatQty, parseDecimalInput, toDecimalInput } from '@/lib/format';
import { useCan } from '@/lib/session';
import { FLEET_API_TO_FORM, FleetFields, fleetFromDto, fleetPayload, type FleetValues } from './fleet-fields';
import { LoadStatusBadge, LoadStepper } from './load-status';
import { useLoad, useLoadMutations } from './logistics-api';
import { InvoiceList } from '@/features/fiscal/invoices-page';
import { OccurrencesPage } from '@/features/fiscal/occurrences-page';
import { UploadDropzone } from '@/features/uploads/upload-dropzone';
import { ReasonDialog } from './reason-dialog';

interface Values extends FleetValues {
  loadingDate: string;
  grossKg: string;
  tareKg: string;
  receivedQty: string;
  notes: string;
}

const PRE_LOADED: LoadStatus[] = ['SCHEDULED', 'CONFIRMED', 'AWAITING_LOADING', 'LOADING', 'AWAITING_FARM_INVOICE', 'FARM_INVOICED'];

export function LoadDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const can = useCan();
  const load = useLoad(id);
  const { update, transition } = useLoadMutations();
  const [cancelOpen, setCancelOpen] = useState(false);
  const form = useForm<Values>();
  const errors = form.formState.errors;
  const l = load.data;
  const canManage = can('load.manage') && l && !['COMPLETED', 'CANCELLED'].includes(l.status);
  const fleetEditable = Boolean(canManage && l && PRE_LOADED.includes(l.status));
  const [gross, tare] = useWatch({ control: form.control, name: ['grossKg', 'tareKg'] });
  const grossN = parseDecimalInput(gross ?? '');
  const tareN = parseDecimalInput(tare ?? '');
  const net = grossN && tareN ? subDec(grossN, tareN) : null;

  useEffect(() => {
    if (!l) return;
    form.reset({
      ...fleetFromDto(l),
      loadingDate: l.loadingDate ?? '',
      grossKg: toDecimalInput(l.grossKg),
      tareKg: toDecimalInput(l.tareKg),
      receivedQty: toDecimalInput(l.receivedQty),
      notes: l.notes ?? '',
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [l?.id, l?.updatedAt]);

  const payload = (v: Values) => ({
    expectedUpdatedAt: l!.updatedAt,
    loadingDate: v.loadingDate,
    ...(fleetEditable ? fleetPayload(v) : {}),
    grossKg: v.grossKg ? parseDecimalInput(v.grossKg) : undefined,
    tareKg: v.tareKg ? parseDecimalInput(v.tareKg) : undefined,
    receivedQty: v.receivedQty ? parseDecimalInput(v.receivedQty) : undefined,
    notes: v.notes,
  });

  const save = form.handleSubmit(async (v) => {
    try {
      await update.mutateAsync({ id: l!.id, data: payload(v) });
      toast.success('Carga atualizada');
    } catch (err) {
      handleSaveError(err, (name, e) => form.setError((FLEET_API_TO_FORM[String(name)] ?? name) as keyof Values, e));
    }
  });

  const move = async (to: LoadStatus, notes?: string) => {
    if (!l) return;
    if (to === 'CANCELLED' && !notes) return setCancelOpen(true);
    const v = form.getValues();
    try {
      // Salva frota/pesagem pendentes antes de avançar.
      let current = l;
      if (form.formState.isDirty) current = { ...l, ...(await update.mutateAsync({ id: l.id, data: payload(v) })) };
      await transition.mutateAsync({
        id: l.id,
        to,
        expectedUpdatedAt: current.updatedAt,
        notes: notes ?? null,
        grossKg: v.grossKg ? parseDecimalInput(v.grossKg) : null,
        tareKg: v.tareKg ? parseDecimalInput(v.tareKg) : null,
        receivedQty: v.receivedQty ? parseDecimalInput(v.receivedQty) : null,
      });
      toast.success(`Carga ${l.number}: ${LOAD_STATUS_LABELS[to]}`);
      setCancelOpen(false);
    } catch (err) {
      if (err instanceof ApiRequestError) {
        handleSaveError(err, (name, e) => form.setError((FLEET_API_TO_FORM[String(name)] ?? name) as keyof Values, e));
      } else toast.error('Não foi possível atualizar a carga.');
    }
  };

  const forward = l?.allowedTransitions.filter((t) => t !== 'CANCELLED') ?? [];

  return (
    <>
      <Drawer
        open={Boolean(id)}
        onRequestClose={onClose}
        title={l ? <span className="font-mono">{l.number}</span> : 'Carregando…'}
        subtitle={
          l ? (
            <span className="flex flex-wrap items-center gap-2">
              <LoadStatusBadge status={l.status} />
              <Link href={`/ordens/${l.order.id}`} className="text-primary hover:underline">
                OC {l.order.number}
              </Link>
              <span>
                · {l.order.farm} → {l.order.buyer}
              </span>
            </span>
          ) : null
        }
        footer={
          l ? (
            <div className="flex flex-wrap items-center gap-2">
              {l.allowedTransitions.includes('CANCELLED') ? (
                <Button variant="ghost" size="sm" onClick={() => setCancelOpen(true)}>
                  <XCircle /> Cancelar carga
                </Button>
              ) : null}
              <div className="ml-auto flex flex-wrap gap-2">
                {canManage && form.formState.isDirty ? (
                  <Button variant="outline" onClick={() => void save()} loading={update.isPending}>
                    <Check /> Salvar
                  </Button>
                ) : null}
                {forward.map((to) => (
                  <Button key={to} onClick={() => void move(to)} loading={transition.isPending && transition.variables?.to === to}>
                    {LOAD_STATUS_LABELS[to]} <ArrowRight />
                  </Button>
                ))}
              </div>
            </div>
          ) : null
        }
      >
        {!l ? (
          <div className="space-y-4 p-7">
            <Skeleton className="h-20" />
            <Skeleton className="h-72" />
          </div>
        ) : (
          <form onSubmit={save} noValidate>
            <div className="space-y-4 px-5 pt-5 sm:px-7">
              <Card className="p-4">
                <LoadStepper status={l.status} />
              </Card>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Stat label="Previsto" value={formatQty(l.expectedQty, l.order.unit)} />
                <Stat label="Peso líquido" value={l.netKg ? formatQty(l.netKg, 'kg') : '—'} />
                <Stat label="Recebido" value={l.receivedQty ? formatQty(l.receivedQty, l.order.unit) : '—'} />
                <Stat
                  label="Divergência"
                  value={
                    l.divergenceKg ? (
                      <span className={Math.abs(Number(l.divergenceKg)) > 100 ? 'text-danger' : ''}>
                        {Math.abs(Number(l.divergenceKg)) > 100 ? <AlertTriangle className="mr-1 inline size-3.5" /> : null}
                        {formatQty(l.divergenceKg, 'kg')}
                      </span>
                    ) : (
                      '—'
                    )
                  }
                />
              </div>
            </div>

            <fieldset disabled={!canManage} className="contents">
              <FormSection title="Transporte" description={fleetEditable ? 'Obrigatório informar motorista e cavalo antes do carregamento.' : 'Frota travada após o carregamento.'}>
                <Field label="Data de carregamento" className={span[3]}>
                  {(a) => <Input {...a} type="date" {...form.register('loadingDate')} />}
                </Field>
                <div className="hidden sm:col-span-3 sm:block" />
                <FleetFields control={form.control} setValue={form.setValue} errors={errors} disabled={!fleetEditable} />
              </FormSection>

              <FormSection title="Pesagem" description="Peso líquido = bruto − tara. Necessário para marcar a carga como carregada.">
                <Field label="Peso bruto (kg)" className={span[2]} error={errors.grossKg?.message}>
                  {(a) => <Input {...a} inputMode="decimal" className="text-right tabular" {...form.register('grossKg')} />}
                </Field>
                <Field label="Tara (kg)" className={span[2]} error={errors.tareKg?.message}>
                  {(a) => <Input {...a} inputMode="decimal" className="text-right tabular" {...form.register('tareKg')} />}
                </Field>
                <div className="flex flex-col justify-end sm:col-span-2">
                  <div className="flex h-9 items-center justify-between rounded-md bg-primary-soft/60 px-3 text-sm">
                    <span className="text-muted">Líquido</span>
                    <span className={net?.startsWith('-') ? 'font-semibold text-danger' : 'font-semibold text-primary tabular'}>{net ? formatQty(net, 'kg') : '—'}</span>
                  </div>
                </div>
              </FormSection>

              <FormSection title="Recebimento">
                <Field label={`Quantidade recebida (${l.order.unit})`} className={span[3]} error={errors.receivedQty?.message} hint="Informe na chegada ao destino">
                  {(a) => <Input {...a} inputMode="decimal" className="text-right tabular" {...form.register('receivedQty')} />}
                </Field>
                <Field label="Observações" className={span[6]}>
                  {(a) => <Textarea {...a} rows={2} {...form.register('notes')} />}
                </Field>
              </FormSection>
            </fieldset>

            <FormSection title="NF-e da carga" description="Envie o XML autorizado: chave, emitente, placa e peso são conferidos automaticamente. Obrigatória para marcar como faturada pela Fazenda.">
              <div className="space-y-3 sm:col-span-6">
                {can('invoice.upload') && l.status !== 'CANCELLED' ? (
                  <UploadDropzone
                    entityType="load"
                    entityId={l.id}
                    accept=".xml,.pdf"
                    title="Arraste o XML da NF-e (ou o DANFE em PDF)"
                    hint="O XML é lido e validado; o PDF fica como anexo da carga"
                    showExisting={false}
                  />
                ) : null}
                <InvoiceList loadId={l.id} />
              </div>
            </FormSection>

            {can('occurrence.read') ? (
              <FormSection title="Ocorrências">
                <div className="sm:col-span-6">
                  <OccurrencesPage
                    embedded
                    orderId={l.order.id}
                    loadId={l.id}
                    defaults={{ order: { id: l.order.id, label: l.order.number }, load: { id: l.id, label: l.number } }}
                  />
                </div>
              </FormSection>
            ) : null}

            <FormSection title="Histórico">
              <ol className="space-y-3 sm:col-span-6">
                {l.history.map((h) => (
                  <li key={h.id} className="flex items-start gap-3 text-sm">
                    <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" aria-hidden />
                    <div className="min-w-0">
                      <div className="font-medium">
                        {h.from ? `${LOAD_STATUS_LABELS[h.from]} → ` : ''}
                        {LOAD_STATUS_LABELS[h.to]}
                      </div>
                      <div className="text-xs text-muted">
                        {h.actor ?? 'Sistema'} · {formatDateTime(h.occurredAt)}
                        {h.notes ? ` · ${h.notes}` : ''}
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
              {l.loadingDate ? <p className="text-xs text-subtle sm:col-span-6">Carregamento previsto para {formatDate(l.loadingDate)}.</p> : null}
            </FormSection>
          </form>
        )}
      </Drawer>
      <ReasonDialog
        open={cancelOpen}
        title="Cancelar carga"
        description="A quantidade prevista volta ao saldo da ordem. Esta ação fica registrada na auditoria."
        confirmLabel="Cancelar carga"
        loading={transition.isPending}
        onCancel={() => setCancelOpen(false)}
        onConfirm={(r) => void move('CANCELLED', r)}
      />
    </>
  );
}
