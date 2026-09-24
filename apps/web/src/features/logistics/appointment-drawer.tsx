'use client';

import type { AppointmentDto, AppointmentStatus } from '@ordens/contracts';
import { AsyncCombobox, Button, Drawer, Field, Input, Textarea, type ComboOption } from '@ordens/ui';
import { CalendarCheck, Check, LogIn, Truck, UserX, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Controller, FormProvider, useForm, useWatch } from 'react-hook-form';
import { toast } from 'sonner';
import { FormSection, handleSaveError, span, Stat } from '@/features/registry/form-utils';
import { ApiRequestError } from '@/lib/api';
import { subDec } from '@/lib/decimal';
import { formatQty, parseDecimalInput, toDecimalInput } from '@/lib/format';
import { useCan } from '@/lib/session';
import { AppointmentStatusBadge } from './load-status';
import { fleetLookups, useAppointmentMutations } from './logistics-api';
import { ReasonDialog } from './reason-dialog';
import { emptyTransport, TransportFields, transportFromDto, transportPayload, type TransportValues } from './transport-fields';

interface Values extends TransportValues {
  order: ComboOption | null;
  scheduledOn: string;
  windowStart: string;
  windowEnd: string;
  expectedQty: string;
  notes: string;
}

const TRANSITION_UI: Partial<Record<AppointmentStatus, { label: string; icon: typeof Check; variant: 'primary' | 'outline' | 'ghost' | 'danger' | 'soft' }>> = {
  CONFIRMED: { label: 'Confirmar', icon: CalendarCheck, variant: 'primary' },
  CHECKED_IN: { label: 'Registrar chegada', icon: LogIn, variant: 'soft' },
  CONVERTED: { label: 'Gerar carga', icon: Truck, variant: 'primary' },
  NO_SHOW: { label: 'Não compareceu', icon: UserX, variant: 'ghost' },
  CANCELLED: { label: 'Cancelar', icon: XCircle, variant: 'ghost' },
};

export function AppointmentDrawer({
  appointment,
  open,
  onClose,
  defaultDate,
  defaultOrder,
}: {
  appointment: AppointmentDto | null;
  open: boolean;
  onClose: () => void;
  defaultDate?: string;
  defaultOrder?: ComboOption | null;
}) {
  const can = useCan();
  const { save, transition } = useAppointmentMutations();
  const editable = can('appointment.manage') && (!appointment || ['REQUESTED', 'CONFIRMED'].includes(appointment.status));
  const [reasonFor, setReasonFor] = useState<AppointmentStatus | null>(null);
  const form = useForm<Values>();
  const errors = form.formState.errors;
  const order = useWatch({ control: form.control, name: 'order' });

  useEffect(() => {
    if (!open) return;
    form.reset(
      appointment
        ? {
            order: { id: appointment.order.id, label: appointment.order.number, description: `${appointment.order.commodity ?? ''} · ${appointment.order.farm ?? ''}` },
            scheduledOn: appointment.scheduledOn,
            windowStart: appointment.windowStart ?? '',
            windowEnd: appointment.windowEnd ?? '',
            expectedQty: toDecimalInput(appointment.expectedQty),
            notes: appointment.notes ?? '',
            ...transportFromDto(appointment),
          }
        : { order: defaultOrder ?? null, scheduledOn: defaultDate ?? new Date().toISOString().slice(0, 10), windowStart: '07:00', windowEnd: '11:00', expectedQty: '', notes: '', ...emptyTransport() },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, appointment?.id, appointment?.updatedAt]);

  const meta = order?.meta;
  const available = meta?.released ? subDec(subDec(meta.released, meta.scheduled ?? '0'), meta.loaded ?? '0') : null;
  const unit = meta?.unit ?? appointment?.order.unit ?? 't';

  const submit = form.handleSubmit(async (v) => {
    if (!v.order) return form.setError('order', { message: 'Selecione a ordem' });
    try {
      await save.mutateAsync({
        id: appointment?.id ?? null,
        data: {
          orderId: v.order.id,
          scheduledOn: v.scheduledOn,
          windowStart: v.windowStart,
          windowEnd: v.windowEnd,
          expectedQty: parseDecimalInput(v.expectedQty),
          notes: v.notes,
          ...transportPayload(v),
        },
      });
      toast.success(appointment ? 'Agendamento atualizado' : 'Agendamento criado', { description: `${v.order.label} · ${v.scheduledOn.split('-').reverse().join('/')}` });
      onClose();
    } catch (err) {
      handleSaveError(err, (name, e) => form.setError((name === 'orderId' ? 'order' : String(name)) as keyof Values, e));
    }
  });

  const move = async (to: AppointmentStatus, reason?: string) => {
    if (!appointment) return;
    if ((to === 'CANCELLED' || to === 'NO_SHOW') && !reason) return setReasonFor(to);
    try {
      await transition.mutateAsync({ id: appointment.id, to, reason });
      toast.success(to === 'CONVERTED' ? 'Carga gerada a partir do agendamento' : 'Agendamento atualizado');
      setReasonFor(null);
      onClose();
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : 'Não foi possível atualizar.');
    }
  };

  return (
    <>
      <Drawer
        open={open}
        size="md"
        onRequestClose={onClose}
        title={appointment ? `Agendamento · ${appointment.order.number}` : 'Novo agendamento'}
        subtitle={appointment ? <AppointmentStatusBadge status={appointment.status} /> : 'Os dados do motorista e dos veículos podem ser informados agora ou na confirmação.'}
        footer={
          <div className="flex flex-wrap items-center gap-2">
            {appointment
              ? appointment.allowedTransitions.map((to) => {
                  const ui = TRANSITION_UI[to];
                  if (!ui) return null;
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
                  <Check /> Salvar
                </Button>
              ) : null}
            </div>
          </div>
        }
      >
        <FormProvider {...form}>
          <form onSubmit={submit} noValidate>
            <fieldset disabled={!editable} className="contents">
            <FormSection title="Ordem e data">
              <Field label="Ordem de carregamento" required className={span[6]} error={errors.order?.message}>
                {(a) => (
                  <Controller
                    control={form.control}
                    name="order"
                    render={({ field }) => (
                      <AsyncCombobox {...a} value={field.value} onChange={field.onChange} disabled={Boolean(appointment) || !editable} queryKey={['lookup', 'orders-logistics']} fetchPage={fleetLookups.orders()} placeholder="Pesquisar OC publicada…" />
                    )}
                  />
                )}
              </Field>
              {meta?.released ? (
                <div className="grid grid-cols-3 gap-2 sm:col-span-6">
                  <Stat label="Liberado" value={formatQty(meta.released, unit)} />
                  <Stat label="Já agendado + carregado" value={formatQty(subDec(meta.released, available ?? meta.released), unit)} />
                  <Stat label="Disponível" value={<span className={available?.startsWith('-') ? 'text-danger' : 'text-primary'}>{formatQty(available, unit)}</span>} />
                </div>
              ) : null}
              <Field label="Data" required className={span[2]} error={errors.scheduledOn?.message}>
                {(a) => <Input {...a} type="date" {...form.register('scheduledOn')} />}
              </Field>
              <Field label="Das" className={span[2]} error={errors.windowStart?.message}>
                {(a) => <Input {...a} type="time" {...form.register('windowStart')} />}
              </Field>
              <Field label="Até" className={span[2]} error={errors.windowEnd?.message}>
                {(a) => <Input {...a} type="time" {...form.register('windowEnd')} />}
              </Field>
              <Field label={`Quantidade prevista (${unit})`} required className={span[3]} error={errors.expectedQty?.message}>
                {(a) => <Input {...a} inputMode="decimal" className="text-right tabular" {...form.register('expectedQty')} placeholder="0,000" />}
              </Field>
            </FormSection>
            <FormSection title="Transporte" description="Dados como no documento do motorista. Ao digitar um nome, CPF ou placa já usados antes, o restante é preenchido.">
              <TransportFields disabled={!editable} />
            </FormSection>
            <FormSection title="Observações">
              <Field label="Observações" className={span[6]}>
                {(a) => <Textarea {...a} rows={3} {...form.register('notes')} />}
              </Field>
            </FormSection>
            </fieldset>
          </form>
        </FormProvider>
      </Drawer>
      <ReasonDialog
        open={reasonFor !== null}
        title={reasonFor === 'NO_SHOW' ? 'Registrar não comparecimento' : 'Cancelar agendamento'}
        description="A quantidade prevista volta ao saldo disponível da ordem."
        confirmLabel={reasonFor === 'NO_SHOW' ? 'Registrar' : 'Cancelar agendamento'}
        loading={transition.isPending}
        onCancel={() => setReasonFor(null)}
        onConfirm={(r) => reasonFor && void move(reasonFor, r)}
      />
    </>
  );
}
