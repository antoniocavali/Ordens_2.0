'use client';

import type { OrderDetail } from '@ordens/contracts';
import { AsyncCombobox, Button, Drawer, Field, Input, Textarea, type ComboOption } from '@ordens/ui';
import { Check, Send } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { toast } from 'sonner';
import { FormSection, span } from '@/features/registry/form-utils';
import { ApiRequestError } from '@/lib/api';
import { formatQty, parseDecimalInput, toDecimalInput } from '@/lib/format';
import { assignFarm, billingPublish, lookups, useInvalidateOrders } from './orders-api';
import { useNoDestinationConfirm } from '@/features/orders/destination-guard';

interface Values {
  contract: ComboOption | null;
  seller: ComboOption | null;
  farm: ComboOption | null;
  unitPrice: string;
  tolerancePct: string;
  requiresReceipt: boolean;
  loadingInstructions: string;
  farmNotes: string;
  internalNotes: string;
}

const API_TO_FORM: Record<string, keyof Values> = { contractId: 'contract', sellerPartnerId: 'seller', farmId: 'farm' };

/** Faturamento: revisa a solicitação do Comprador, define vendedor/fazenda e publica para a Fazenda. */
export function AssignFarmDrawer({ order, open, onClose }: { order: OrderDetail; open: boolean; onClose: () => void }) {
  const invalidate = useInvalidateOrders();
  const [busy, setBusy] = useState<'save' | 'publish' | null>(null);
  const form = useForm<Values>();
  const errors = form.formState.errors;
  const [contract, seller] = useWatch({ control: form.control, name: ['contract', 'seller'] });

  useEffect(() => {
    if (!open) return;
    form.reset({
      contract: order.contract ? { id: order.contract.id, label: order.contract.number } : null,
      seller: order.seller ? { id: order.seller.id, label: order.seller.name } : null,
      farm: order.farm ? { id: order.farm.id, label: order.farm.name } : null,
      unitPrice: toDecimalInput(order.unitPrice),
      tolerancePct: order.tolerancePct && order.tolerancePct !== '0' ? toDecimalInput(order.tolerancePct) : '',
      requiresReceipt: order.requiresReceipt,
      loadingInstructions: order.loadingInstructions ?? '',
      farmNotes: order.farmNotes ?? '',
      internalNotes: order.internalNotes ?? '',
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, order.id, order.updatedAt]);

  const [confirmDestination, destinationDialog] = useNoDestinationConfirm('Publicar sem destino');
  const run = (publish: boolean) =>
    form.handleSubmit(async (v) => {
      if (!v.seller || !v.farm) {
        if (!v.seller) form.setError('seller', { message: 'Selecione o vendedor' });
        if (!v.farm) form.setError('farm', { message: 'Selecione a fazenda' });
        return;
      }
      setBusy(publish ? 'publish' : 'save');
      try {
        let saved = await assignFarm(order.id, {
          expectedUpdatedAt: order.updatedAt,
          sellerPartnerId: v.seller.id,
          farmId: v.farm.id,
          contractId: v.contract?.id ?? null,
          unitPrice: v.unitPrice ? parseDecimalInput(v.unitPrice) : null,
          tolerancePct: v.tolerancePct ? parseDecimalInput(v.tolerancePct) : null,
          requiresReceipt: v.requiresReceipt,
          loadingInstructions: v.loadingInstructions.trim() || null,
          farmNotes: v.farmNotes.trim() || null,
          internalNotes: v.internalNotes.trim() || null,
        });
        if (publish) saved = await billingPublish(saved.id, saved.updatedAt);
        invalidate(saved);
        toast.success(publish ? `Ordem ${saved.number} publicada para a Fazenda` : 'Fazenda definida', {
          description: publish ? `${saved.farm?.name ?? 'Fazenda'} foi notificada.` : 'A solicitação continua aguardando faturamento.',
        });
        onClose();
      } catch (err) {
        if (err instanceof ApiRequestError) {
          for (const [field, messages] of Object.entries(err.fieldErrors)) form.setError((API_TO_FORM[field] ?? field) as keyof Values, { type: 'server', message: messages[0] });
          toast.error(err.message);
        } else toast.error('Não foi possível concluir.');
      } finally {
        setBusy(null);
      }
    })();

  return (
    <>
      {destinationDialog}
    <Drawer
      open={open}
      onRequestClose={onClose}
      title={`Faturamento · ${order.number}`}
      subtitle={`${order.buyer?.name ?? 'Comprador'} · ${order.commodity?.name ?? '—'} · ${formatQty(order.quantities.total, order.quantities.unit)}`}
      footer={
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="outline" onClick={() => void run(false)} loading={busy === 'save'} disabled={busy !== null}>
            <Check /> Salvar
          </Button>
          <Button onClick={() => confirmDestination(Boolean(order.destinationName?.trim()), () => void run(true))} loading={busy === 'publish'} disabled={busy !== null}>
            <Send /> Salvar e publicar para a Fazenda
          </Button>
        </div>
      }
    >
      <form onSubmit={(e) => e.preventDefault()} noValidate>
        <FormSection title="Origem do carregamento" description="A Fazenda só vê a ordem depois da publicação.">
          <Field label="Contrato" className={span[6]} error={errors.contract?.message} hint="Opcional: filtra o vendedor e valida commodity e saldo.">
            {(a) => (
              <Controller
                control={form.control}
                name="contract"
                render={({ field }) => (
                  <AsyncCombobox
                    {...a}
                    value={field.value}
                    onChange={(v) => {
                      field.onChange(v);
                      form.setValue('seller', null);
                      form.setValue('farm', null);
                    }}
                    queryKey={['lookup', 'contracts', order.buyer?.id ?? null, order.commodity?.id ?? null]}
                    fetchPage={lookups.contracts({ buyerId: order.buyer?.id, commodityId: order.commodity?.id })}
                    placeholder="Sem contrato"
                  />
                )}
              />
            )}
          </Field>
          <Field label="Vendedor" required className={span[3]} error={errors.seller?.message}>
            {(a) => (
              <Controller
                control={form.control}
                name="seller"
                render={({ field }) => (
                  <AsyncCombobox
                    {...a}
                    value={field.value}
                    onChange={(v) => {
                      field.onChange(v);
                      form.setValue('farm', null);
                    }}
                    queryKey={['lookup', 'sellers', contract?.id ?? null]}
                    fetchPage={lookups.sellers(contract?.id)}
                    placeholder="Pesquisar vendedor…"
                  />
                )}
              />
            )}
          </Field>
          <Field label="Fazenda responsável" required className={span[3]} error={errors.farm?.message}>
            {(a) => (
              <Controller
                control={form.control}
                name="farm"
                render={({ field }) => (
                  <AsyncCombobox
                    {...a}
                    value={field.value}
                    onChange={field.onChange}
                    disabled={!seller}
                    disabledHint="Selecione o vendedor primeiro"
                    queryKey={['lookup', 'farms', seller?.id ?? null]}
                    fetchPage={lookups.farms(seller?.id ?? '')}
                    placeholder="Pesquisar fazenda…"
                  />
                )}
              />
            )}
          </Field>
        </FormSection>

        <FormSection title="Dados internos">
          <Field label="Preço" className={span[3]} error={errors.unitPrice?.message}>
            {(a) => <Input {...a} inputMode="decimal" className="text-right tabular" {...form.register('unitPrice')} placeholder="0,00" />}
          </Field>
          <Field label="Tolerância (%)" className={span[3]} error={errors.tolerancePct?.message}>
            {(a) => <Input {...a} inputMode="decimal" className="text-right tabular" {...form.register('tolerancePct')} placeholder="0" />}
          </Field>
          <label className="flex cursor-pointer items-start gap-2.5 rounded-lg px-3 py-2.5 ring-1 ring-border hover:bg-surface-2 sm:col-span-6">
            <input type="checkbox" className="mt-0.5 size-4 accent-[var(--color-primary)]" {...form.register('requiresReceipt')} />
            <span className="min-w-0 text-sm">
              <span className="block font-medium">Exigir recebimento no destino</span>
              <span className="block text-xs text-muted">Desmarcado, a carga segue do trânsito direto para o faturamento da Matriz.</span>
            </span>
          </label>
          <Field label="Instruções de carregamento (Fazenda)" className={span[6]}>
            {(a) => <Textarea {...a} rows={2} {...form.register('loadingInstructions')} />}
          </Field>
          <Field label="Observação para a Fazenda" className={span[6]}>
            {(a) => <Textarea {...a} rows={2} {...form.register('farmNotes')} />}
          </Field>
          <Field label="Observação interna (somente Matriz)" className={span[6]}>
            {(a) => <Textarea {...a} rows={2} {...form.register('internalNotes')} />}
          </Field>
        </FormSection>

        {order.buyerNotes ? (
          <FormSection title="Observações do Comprador">
            <p className="whitespace-pre-wrap rounded-lg bg-surface-2 p-3 text-sm sm:col-span-6">{order.buyerNotes}</p>
          </FormSection>
        ) : null}
      </form>
    </Drawer>
    </>
  );
}
