'use client';

import { FREIGHT_MODES, type OrderDetail } from '@ordens/contracts';
import { AsyncCombobox, Button, Drawer, Field, Input, Select, Textarea, type ComboOption } from '@ordens/ui';
import { Check, Send } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { FormSection, span } from '@/features/registry/form-utils';
import { ApiRequestError } from '@/lib/api';
import { parseDecimalInput, toDecimalInput } from '@/lib/format';
import { createBuyerOrder, lookups, submitOrder, updateBuyerOrder, useInvalidateOrders, useUnits } from './orders-api';

interface Values {
  commodity: ComboOption | null;
  quantity: string;
  unitId: string;
  cropYear: string;
  loadingStartsOn: string;
  loadingEndsOn: string;
  destinationName: string;
  destinationCity: string;
  destinationState: string;
  destinationAddress: string;
  freightMode: string;
  carrier: ComboOption | null;
  externalNumber: string;
  buyerNotes: string;
}

const FREIGHT_LABELS: Record<string, string> = { FOB: 'FOB (retira na origem)', CIF: 'CIF (entregue no destino)', TO_DEFINE: 'A definir' };
const API_TO_FORM: Record<string, keyof Values> = { commodityId: 'commodity', preferredCarrierId: 'carrier' };

const fromDetail = (o: OrderDetail | null): Values => ({
  commodity: o?.commodity ? { id: o.commodity.id, label: o.commodity.name } : null,
  quantity: o && o.quantities.total !== '0' ? toDecimalInput(o.quantities.total) : '',
  unitId: o?.unit?.id ?? '',
  cropYear: o?.cropYear ?? '',
  loadingStartsOn: o?.loadingStartsOn ?? '',
  loadingEndsOn: o?.loadingEndsOn ?? '',
  destinationName: o?.destinationName ?? '',
  destinationCity: o?.destinationCity ?? '',
  destinationState: o?.destinationState ?? '',
  destinationAddress: o?.destinationAddress ?? '',
  freightMode: o?.freightMode ?? '',
  carrier: o?.preferredCarrier ? { id: o.preferredCarrier.id, label: o.preferredCarrier.name } : null,
  externalNumber: o?.externalNumber ?? '',
  buyerNotes: o?.buyerNotes ?? '',
});

const txt = (v: string) => (v.trim() ? v.trim() : null);

/** Payload do portal: somente campos do Comprador (vendedor, fazenda e dados internos nunca são enviados). */
const toPayload = (v: Values) => ({
  commodityId: v.commodity?.id ?? null,
  quantity: v.quantity ? parseDecimalInput(v.quantity) : null,
  unitId: v.unitId || null,
  cropYear: txt(v.cropYear),
  loadingStartsOn: v.loadingStartsOn || null,
  loadingEndsOn: v.loadingEndsOn || null,
  destinationName: txt(v.destinationName),
  destinationCity: txt(v.destinationCity),
  destinationState: v.destinationState.trim() ? v.destinationState.trim().toUpperCase() : null,
  destinationAddress: txt(v.destinationAddress),
  freightMode: v.freightMode || null,
  preferredCarrierId: v.carrier?.id ?? null,
  externalNumber: txt(v.externalNumber),
  buyerNotes: txt(v.buyerNotes),
});

/** Formulário do Comprador: cria/edita o próprio rascunho e envia ao Faturamento da Matriz. */
export function BuyerOrderDrawer({ open, order, onClose }: { open: boolean; order: OrderDetail | null; onClose: () => void }) {
  const form = useForm<Values>({ defaultValues: fromDetail(order) });
  const units = useUnits();
  const invalidate = useInvalidateOrders();
  const [busy, setBusy] = useState<'save' | 'submit' | null>(null);
  const errors = form.formState.errors;

  useEffect(() => {
    if (open) form.reset(fromDetail(order));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, order?.id, order?.updatedAt]);

  const run = (submit: boolean) =>
    form.handleSubmit(async (v) => {
      setBusy(submit ? 'submit' : 'save');
      try {
        let saved = order ? await updateBuyerOrder(order.id, order.updatedAt, toPayload(v)) : await createBuyerOrder(toPayload(v));
        if (submit) saved = await submitOrder(saved.id, saved.updatedAt);
        invalidate(saved);
        toast.success(submit ? `Solicitação ${saved.number} enviada ao Faturamento` : `Rascunho ${saved.number} salvo`, {
          description: submit ? 'A Matriz vai definir a fazenda e publicar a ordem.' : undefined,
        });
        onClose();
      } catch (err) {
        if (err instanceof ApiRequestError) {
          for (const [field, messages] of Object.entries(err.fieldErrors)) {
            form.setError((API_TO_FORM[field] ?? field) as keyof Values, { type: 'server', message: messages[0] });
          }
          toast.error(err.message);
        } else toast.error('Não foi possível salvar a solicitação.');
      } finally {
        setBusy(null);
      }
    })();

  return (
    <Drawer
      open={open}
      onRequestClose={onClose}
      title={order ? `Solicitação ${order.number}` : 'Nova solicitação de ordem'}
      subtitle="Informe o que precisa carregar. O Faturamento da Matriz define vendedor e fazenda antes de publicar."
      footer={
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="outline" onClick={() => void run(false)} loading={busy === 'save'} disabled={busy !== null}>
            <Check /> Salvar rascunho
          </Button>
          <Button onClick={() => void run(true)} loading={busy === 'submit'} disabled={busy !== null}>
            <Send /> Enviar ao Faturamento
          </Button>
        </div>
      }
    >
      <form onSubmit={(e) => e.preventDefault()} noValidate>
        <FormSection title="Produto e quantidade">
          <Field label="Commodity" required className={span[4]} error={errors.commodity?.message}>
            {(a) => (
              <Controller
                control={form.control}
                name="commodity"
                render={({ field }) => <AsyncCombobox {...a} value={field.value} onChange={field.onChange} queryKey={['lookup', 'commodities', null]} fetchPage={lookups.commodities()} placeholder="Milho, soja, algodão…" />}
              />
            )}
          </Field>
          <Field label="Safra" className={span[2]} error={errors.cropYear?.message}>
            {(a) => <Input {...a} {...form.register('cropYear')} placeholder="25/26" />}
          </Field>
          <Field label="Quantidade" required className={span[3]} error={errors.quantity?.message}>
            {(a) => <Input {...a} inputMode="decimal" className="text-right tabular" {...form.register('quantity')} placeholder="0,000" />}
          </Field>
          <Field label="Unidade" required className={span[3]} error={errors.unitId?.message}>
            {(a) => <Select {...a} {...form.register('unitId')} placeholder="Selecione" options={(units.data ?? []).map((u) => ({ value: u.id, label: u.label }))} />}
          </Field>
          <Field label="Sua referência (pedido)" className={span[3]}>
            {(a) => <Input {...a} {...form.register('externalNumber')} />}
          </Field>
        </FormSection>

        <FormSection title="Janela de carregamento">
          <Field label="Início" required className={span[3]} error={errors.loadingStartsOn?.message}>
            {(a) => <Input {...a} type="date" {...form.register('loadingStartsOn')} />}
          </Field>
          <Field label="Data limite" required className={span[3]} error={errors.loadingEndsOn?.message}>
            {(a) => <Input {...a} type="date" {...form.register('loadingEndsOn')} />}
          </Field>
        </FormSection>

        <FormSection title="Destino e frete">
          <Field label="Unidade de recebimento" className={span[3]} error={errors.destinationName?.message}>
            {(a) => <Input {...a} {...form.register('destinationName')} placeholder="Ex.: Fábrica Chapecó" />}
          </Field>
          <Field label="Cidade" className={span[2]}>
            {(a) => <Input {...a} {...form.register('destinationCity')} />}
          </Field>
          <Field label="UF" className={span[1]} error={errors.destinationState?.message}>
            {(a) => <Input {...a} maxLength={2} className="uppercase" {...form.register('destinationState')} />}
          </Field>
          <Field label="Endereço de entrega" className={span[6]}>
            {(a) => <Input {...a} {...form.register('destinationAddress')} />}
          </Field>
          <Field label="Modalidade de frete" className={span[3]} error={errors.freightMode?.message}>
            {(a) => <Select {...a} {...form.register('freightMode')} placeholder="Selecione" options={FREIGHT_MODES.map((m) => ({ value: m, label: FREIGHT_LABELS[m] ?? m }))} />}
          </Field>
          <Field label="Transportadora preferencial" className={span[3]} error={errors.carrier?.message}>
            {(a) => (
              <Controller
                control={form.control}
                name="carrier"
                render={({ field }) => <AsyncCombobox {...a} value={field.value} onChange={field.onChange} queryKey={['lookup', 'carriers', null]} fetchPage={lookups.carriers()} placeholder="Opcional" />}
              />
            )}
          </Field>
        </FormSection>

        <FormSection title="Observações">
          <Field label="Observações para a Matriz" className={span[6]}>
            {(a) => <Textarea {...a} rows={3} {...form.register('buyerNotes')} placeholder="Condições de recebimento, horários, restrições…" />}
          </Field>
        </FormSection>
      </form>
    </Drawer>
  );
}
