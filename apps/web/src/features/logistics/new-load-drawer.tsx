'use client';

import type { LoadDto } from '@ordens/contracts';
import { Button, Drawer, Field, Input, Textarea } from '@ordens/ui';
import { Check } from 'lucide-react';
import { useEffect } from 'react';
import { FormProvider, useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { useOrder } from '@/features/orders/orders-api';
import { FormSection, handleSaveError, span, Stat } from '@/features/registry/form-utils';
import { post } from '@/lib/api';
import { subDec } from '@/lib/decimal';
import { formatQty, parseDecimalInput } from '@/lib/format';
import { useInvalidateLogistics } from './logistics-api';
import { emptyTransport, TransportFields, transportFromDto, transportPayload, type TransportValues } from './transport-fields';

interface Values extends TransportValues {
  loadingDate: string;
  expectedQty: string;
  notes: string;
}

/**
 * Carga criada direto da ordem, sem passar por agendamento (o caminhão já está na fazenda). O
 * transporte vem do que o Comprador informou na ordem e pode ser corrigido aqui.
 */
export function NewLoadDrawer({ orderId, open, onClose }: { orderId: string | null; open: boolean; onClose: () => void }) {
  const order = useOrder(open ? orderId : null);
  const invalidate = useInvalidateLogistics();
  const form = useForm<Values>();
  const errors = form.formState.errors;
  const o = order.data;

  useEffect(() => {
    if (!open || !o) return;
    form.reset({
      loadingDate: new Date().toISOString().slice(0, 10),
      expectedQty: '',
      notes: '',
      ...(o.transport.driverName || o.transport.carrierName || o.transport.vehicles.length ? transportFromDto(o.transport) : emptyTransport()),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, o?.id]);

  const available = o ? subDec(subDec(o.quantities.released, o.quantities.scheduled), o.quantities.loaded) : null;

  const submit = form.handleSubmit(async (v) => {
    if (!o) return;
    try {
      const load = await post<LoadDto>('/loads', {
        orderId: o.id,
        loadingDate: v.loadingDate,
        expectedQty: parseDecimalInput(v.expectedQty),
        notes: v.notes,
        ...transportPayload(v),
      });
      toast.success(`Carga ${load.number} criada`, { description: `Ordem ${o.number}` });
      invalidate();
      onClose();
    } catch (err) {
      handleSaveError(err, (name, e) => form.setError(String(name) as keyof Values, e));
    }
  });

  return (
    <Drawer
      open={open}
      size="md"
      onRequestClose={onClose}
      title={o ? `Nova carga · ${o.number}` : 'Nova carga'}
      subtitle="A carga nasce agendada. O transporte vem da ordem e pode ser ajustado."
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={() => void submit()} loading={form.formState.isSubmitting} disabled={!o}>
            <Check /> Criar carga
          </Button>
        </div>
      }
    >
      <FormProvider {...form}>
        <form onSubmit={submit} noValidate>
          <FormSection title="Carga">
            {o ? (
              <div className="grid grid-cols-3 gap-2 sm:col-span-6">
                <Stat label="Liberado" value={formatQty(o.quantities.released, o.quantities.unit)} />
                <Stat label="Agendado + carregado" value={formatQty(subDec(o.quantities.released, available ?? o.quantities.released), o.quantities.unit)} />
                <Stat label="Disponível" value={<span className={available?.startsWith('-') ? 'text-danger' : 'text-primary'}>{formatQty(available, o.quantities.unit)}</span>} />
              </div>
            ) : null}
            <Field label="Data de carregamento" className={span[3]} error={errors.loadingDate?.message}>
              {(a) => <Input {...a} type="date" {...form.register('loadingDate')} />}
            </Field>
            <Field label={`Quantidade prevista (${o?.quantities.unit ?? 't'})`} required className={span[3]} error={errors.expectedQty?.message}>
              {(a) => <Input {...a} inputMode="decimal" className="text-right tabular" {...form.register('expectedQty')} placeholder="0,000" />}
            </Field>
          </FormSection>
          <FormSection title="Transporte" description="Informado pelo Comprador na ordem. Ajuste se o caminhão que chegou for outro.">
            <TransportFields />
          </FormSection>
          <FormSection title="Observações">
            <Field label="Observações" className={span[6]}>
              {(a) => <Textarea {...a} rows={3} {...form.register('notes')} />}
            </Field>
          </FormSection>
        </form>
      </FormProvider>
    </Drawer>
  );
}
