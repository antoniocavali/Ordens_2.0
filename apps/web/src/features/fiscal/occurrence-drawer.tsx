'use client';

import {
  DOCUMENT_VISIBILITY_LABELS,
  OCCURRENCE_SEVERITY_LABELS,
  OCCURRENCE_STATUS_LABELS,
  OCCURRENCE_TYPE_LABELS,
  type DocumentVisibility,
  type LoadDto,
  type OccurrenceDto,
  type OccurrenceSeverity,
  type OccurrenceStatus,
  type OccurrenceType,
  type Page,
} from '@ordens/contracts';
import { AsyncCombobox, Button, Drawer, Field, Input, Textarea, type ComboOption } from '@ordens/ui';
import { Bot, Check, CheckCircle2, PlayCircle, RotateCcw, XCircle, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { toast } from 'sonner';
import { fleetLookups } from '@/features/logistics/logistics-api';
import { ReasonDialog } from '@/features/logistics/reason-dialog';
import { FormSection, handleSaveError, span } from '@/features/registry/form-utils';
import { UploadDropzone } from '@/features/uploads/upload-dropzone';
import { ApiRequestError, get } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { useCan, useMe } from '@/lib/session';
import { OccurrenceStatusBadge, SeverityBadge, VisibilityBadge } from './badges';
import { ChipGroup } from './chip-group';
import { responsibleLookup, useOccurrenceMutations } from './fiscal-api';

interface Values {
  order: ComboOption | null;
  load: ComboOption | null;
  type: OccurrenceType;
  severity: OccurrenceSeverity;
  title: string;
  description: string;
  visibility: DocumentVisibility;
  responsible: ComboOption | null;
  dueOn: string;
}

export interface OccurrenceDefaults {
  order?: ComboOption | null;
  load?: ComboOption | null;
}

const options = <T extends string>(labels: Record<T, string>) => (Object.entries(labels) as [T, string][]).map(([value, label]) => ({ value, label }));

const TRANSITION_UI: Record<OccurrenceStatus, { label: string; icon: LucideIcon; variant: 'primary' | 'soft' | 'ghost' | 'outline' }> = {
  OPEN: { label: 'Reabrir', icon: RotateCcw, variant: 'outline' },
  IN_PROGRESS: { label: 'Iniciar tratamento', icon: PlayCircle, variant: 'soft' },
  RESOLVED: { label: 'Resolver', icon: CheckCircle2, variant: 'primary' },
  CANCELLED: { label: 'Cancelar', icon: XCircle, variant: 'ghost' },
};

const API_TO_FORM: Record<string, keyof Values> = { orderId: 'order', loadId: 'load', responsibleUserId: 'responsible' };

export function OccurrenceDrawer({
  occurrence,
  open,
  onClose,
  defaults,
}: {
  occurrence: OccurrenceDto | null;
  open: boolean;
  onClose: () => void;
  defaults?: OccurrenceDefaults;
}) {
  const can = useCan();
  const { data: me } = useMe();
  const isFarm = me?.activeMembership?.scope === 'FARM';
  const { save, transition } = useOccurrenceMutations();
  const closed = occurrence ? occurrence.status === 'RESOLVED' || occurrence.status === 'CANCELLED' : false;
  const editable = can('occurrence.manage') && !closed;
  const [closing, setClosing] = useState<OccurrenceStatus | null>(null);
  const form = useForm<Values>();
  const errors = form.formState.errors;
  const order = useWatch({ control: form.control, name: 'order' });

  useEffect(() => {
    if (!open) return;
    form.reset(
      occurrence
        ? {
            order: { id: occurrence.order.id, label: occurrence.order.number },
            load: occurrence.load ? { id: occurrence.load.id, label: occurrence.load.number } : null,
            type: occurrence.type,
            severity: occurrence.severity,
            title: occurrence.title,
            description: occurrence.description ?? '',
            visibility: occurrence.visibility,
            responsible: occurrence.responsible ? { id: occurrence.responsible.id, label: occurrence.responsible.name } : null,
            dueOn: occurrence.dueOn ?? '',
          }
        : {
            order: defaults?.order ?? null,
            load: defaults?.load ?? null,
            type: 'OTHER',
            severity: 'MEDIUM',
            title: '',
            description: '',
            visibility: isFarm ? 'FARM' : 'INTERNAL',
            responsible: null,
            dueOn: '',
          },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, occurrence?.id, occurrence?.updatedAt]);

  const visibilityOptions = options(DOCUMENT_VISIBILITY_LABELS).filter((o) => !isFarm || o.value === 'FARM' || o.value === 'PARTIES');

  const submit = form.handleSubmit(async (v) => {
    if (!v.order) return form.setError('order', { message: 'Selecione a ordem' });
    try {
      const saved = await save.mutateAsync({
        id: occurrence?.id ?? null,
        expectedUpdatedAt: occurrence?.updatedAt,
        data: {
          orderId: v.order.id,
          loadId: v.load?.id ?? null,
          type: v.type,
          severity: v.severity,
          title: v.title,
          description: v.description,
          visibility: v.visibility,
          responsibleUserId: v.responsible?.id ?? null,
          dueOn: v.dueOn,
        },
      });
      toast.success(occurrence ? 'Ocorrência atualizada' : `Ocorrência ${saved.number} aberta`);
      onClose();
    } catch (err) {
      handleSaveError(err, (name, e) => form.setError(API_TO_FORM[String(name)] ?? (name as keyof Values), e));
    }
  });

  const move = async (to: OccurrenceStatus, resolution?: string) => {
    if (!occurrence) return;
    if ((to === 'RESOLVED' || to === 'CANCELLED') && !resolution) return setClosing(to);
    try {
      await transition.mutateAsync({ id: occurrence.id, to, expectedUpdatedAt: occurrence.updatedAt, resolution });
      toast.success(`Ocorrência ${occurrence.number}: ${OCCURRENCE_STATUS_LABELS[to]}`);
      setClosing(null);
      onClose();
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : 'Não foi possível atualizar a ocorrência.');
    }
  };

  const loadsFor = (orderId?: string) => async ({ q }: { q: string }) => {
    if (!orderId) return { nextCursor: null, items: [] };
    const page = await get<Page<LoadDto>>('/loads', { orderId, q, pageSize: 50 });
    return { nextCursor: null, items: page.items.map((l) => ({ id: l.id, label: l.number, description: l.plates.join(' · ') || undefined })) };
  };

  return (
    <>
      <Drawer
        open={open}
        size="md"
        onRequestClose={onClose}
        title={occurrence ? <span className="font-mono">{occurrence.number}</span> : 'Nova ocorrência'}
        subtitle={
          occurrence ? (
            <span className="flex flex-wrap items-center gap-2">
              <OccurrenceStatusBadge status={occurrence.status} />
              <SeverityBadge severity={occurrence.severity} />
              <VisibilityBadge visibility={occurrence.visibility} />
              <Link href={`/ordens/${occurrence.order.id}`} className="text-primary hover:underline">
                OC {occurrence.order.number}
              </Link>
            </span>
          ) : (
            'Registre problemas de qualidade, atrasos, documentos ou veículos vinculados à ordem.'
          )
        }
        footer={
          <div className="flex flex-wrap items-center gap-2">
            {occurrence
              ? occurrence.allowedTransitions.map((to) => {
                  const ui = TRANSITION_UI[to];
                  return (
                    <Button key={to} size="sm" variant={ui.variant} onClick={() => void move(to)} loading={transition.isPending && transition.variables?.to === to}>
                      <ui.icon /> {ui.label}
                    </Button>
                  );
                })
              : null}
            <div className="ml-auto flex gap-2">
              <Button variant="ghost" onClick={onClose}>
                Fechar
              </Button>
              {editable ? (
                <Button onClick={() => void submit()} loading={save.isPending}>
                  <Check /> {occurrence ? 'Salvar' : 'Abrir ocorrência'}
                </Button>
              ) : null}
            </div>
          </div>
        }
      >
        <form onSubmit={submit} noValidate>
          {occurrence ? (
            <div className="space-y-2 px-5 pt-5 text-xs text-muted sm:px-7">
              {occurrence.source === 'SYSTEM' ? (
                <div className="flex items-center gap-2 rounded-md bg-info-soft px-3 py-2 text-info">
                  <Bot className="size-4" /> Aberta automaticamente pelo sistema na conferência da carga.
                </div>
              ) : null}
              <div>
                Aberta {formatDateTime(occurrence.createdAt)}
                {occurrence.createdBy ? ` por ${occurrence.createdBy}` : ''}
                {occurrence.resolvedAt ? ` · encerrada ${formatDateTime(occurrence.resolvedAt)}` : ''}
              </div>
              {occurrence.resolution ? (
                <div className="rounded-md bg-success-soft px-3 py-2 text-sm text-text">
                  <div className="text-xs font-semibold uppercase tracking-wider text-success">
                    {occurrence.status === 'CANCELLED' ? 'Motivo do cancelamento' : 'Solução'}
                  </div>
                  {occurrence.resolution}
                </div>
              ) : null}
            </div>
          ) : null}

          <fieldset disabled={!editable} className="contents">
            <FormSection title="Vínculo">
              <Field label="Ordem de carregamento" required className={span[3]} error={errors.order?.message}>
                {(a) => (
                  <Controller
                    control={form.control}
                    name="order"
                    render={({ field }) => (
                      <AsyncCombobox
                        {...a}
                        value={field.value}
                        onChange={(next) => {
                          field.onChange(next);
                          form.setValue('load', null);
                        }}
                        disabled={Boolean(occurrence || defaults?.order) || !editable}
                        queryKey={['lookup', 'orders-logistics']}
                        fetchPage={fleetLookups.orders()}
                        placeholder="Pesquisar OC…"
                      />
                    )}
                  />
                )}
              </Field>
              <Field label="Carga (opcional)" className={span[3]} error={errors.load?.message}>
                {(a) => (
                  <Controller
                    control={form.control}
                    name="load"
                    render={({ field }) => (
                      <AsyncCombobox
                        {...a}
                        value={field.value}
                        onChange={field.onChange}
                        disabled={Boolean(occurrence || defaults?.load) || !order || !editable}
                        queryKey={['lookup', 'loads-of-order', order?.id]}
                        fetchPage={loadsFor(order?.id)}
                        placeholder={order ? 'Pesquisar carga…' : 'Selecione a ordem primeiro'}
                      />
                    )}
                  />
                )}
              </Field>
            </FormSection>

            <FormSection title="Classificação">
              <Field label="Tipo" className={span[6]}>
                {() => (
                  <Controller
                    control={form.control}
                    name="type"
                    render={({ field }) => <ChipGroup label="Tipo" value={field.value} onChange={field.onChange} options={options(OCCURRENCE_TYPE_LABELS)} disabled={!editable} />}
                  />
                )}
              </Field>
              <Field label="Gravidade" className={span[6]}>
                {() => (
                  <Controller
                    control={form.control}
                    name="severity"
                    render={({ field }) => (
                      <ChipGroup label="Gravidade" value={field.value} onChange={field.onChange} options={options(OCCURRENCE_SEVERITY_LABELS)} disabled={!editable} />
                    )}
                  />
                )}
              </Field>
              <Field label="Título" required className={span[6]} error={errors.title?.message}>
                {(a) => <Input {...a} maxLength={160} placeholder="Ex.: Umidade acima do contratado" {...form.register('title')} />}
              </Field>
              <Field label="Descrição" className={span[6]} error={errors.description?.message}>
                {(a) => <Textarea {...a} rows={4} placeholder="O que aconteceu, onde e qual o impacto." {...form.register('description')} />}
              </Field>
            </FormSection>

            <FormSection title="Tratamento" description={isFarm ? 'Ocorrências abertas pela Fazenda ficam visíveis para ela e para a Matriz.' : undefined}>
              {!isFarm ? (
                <Field label="Responsável na Matriz" className={span[3]} error={errors.responsible?.message}>
                  {(a) => (
                    <Controller
                      control={form.control}
                      name="responsible"
                      render={({ field }) => (
                        <AsyncCombobox {...a} value={field.value} onChange={field.onChange} disabled={!editable} queryKey={['lookup', 'responsibles']} fetchPage={responsibleLookup} placeholder="Sem responsável" />
                      )}
                    />
                  )}
                </Field>
              ) : null}
              <Field label="Prazo" className={span[3]} error={errors.dueOn?.message}>
                {(a) => <Input {...a} type="date" {...form.register('dueOn')} />}
              </Field>
              <Field label="Quem pode ver" className={span[6]}>
                {() => (
                  <Controller
                    control={form.control}
                    name="visibility"
                    render={({ field }) => <ChipGroup label="Quem pode ver" value={field.value} onChange={field.onChange} options={visibilityOptions} disabled={!editable} />}
                  />
                )}
              </Field>
            </FormSection>
          </fieldset>

          {occurrence ? (
            <FormSection title="Anexos" description="Fotos, laudos e comprovantes. Seguem a visibilidade da ocorrência definida pela Matriz.">
              <div className="sm:col-span-6">
                <UploadDropzone entityType="occurrence" entityId={can('document.upload') ? occurrence.id : null} disabledReason="Seu perfil não permite enviar anexos" accept=".pdf,.jpg,.jpeg,.png,.webp" hint="PDF ou imagens" />
              </div>
            </FormSection>
          ) : null}
        </form>
      </Drawer>
      <ReasonDialog
        open={closing !== null}
        tone={closing === 'RESOLVED' ? 'primary' : 'danger'}
        title={closing === 'RESOLVED' ? 'Resolver ocorrência' : 'Cancelar ocorrência'}
        fieldLabel={closing === 'RESOLVED' ? 'Solução aplicada' : 'Motivo'}
        description={closing === 'RESOLVED' ? 'Descreva como o problema foi resolvido. Fica registrado na auditoria.' : 'Informe por que a ocorrência não procede.'}
        confirmLabel={closing === 'RESOLVED' ? 'Resolver' : 'Cancelar ocorrência'}
        loading={transition.isPending}
        onCancel={() => setClosing(null)}
        onConfirm={(r) => closing && void move(closing, r)}
      />
    </>
  );
}
