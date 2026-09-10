'use client';

import {
  CONTRACT_STATUS_LABELS,
  CONTRACT_STATUSES,
  contractInputSchema,
  FREIGHT_MODES,
  type ContractDetail,
  type ContractListItem,
  type ContractStatus,
} from '@ordens/contracts';
import { AsyncCombobox, Badge, Button, Card, Drawer, Field, Input, Select, Skeleton, Textarea, Tooltip, type ComboOption } from '@ordens/ui';
import { useQuery } from '@tanstack/react-query';
import { Check, FileSignature } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { toast } from 'sonner';
import type { z } from 'zod';
import { StatusBadge } from '@/features/orders/indicators';
import { lookups, useUnits } from '@/features/orders/orders-api';
import { FormSection, handleSaveError, span, Stat, useInvalidateRegistry } from '@/features/registry/form-utils';
import { RegistryList } from '@/features/registry/registry-list';
import { get, post, put } from '@/lib/api';
import { mulDec } from '@/lib/decimal';
import { formatDate, formatMoney, formatQty, parseDecimalInput, ratio, toDecimalInput } from '@/lib/format';
import { useCan } from '@/lib/session';

const TONE: Record<ContractStatus, 'neutral' | 'success' | 'info' | 'danger'> = { DRAFT: 'neutral', ACTIVE: 'success', CLOSED: 'info', CANCELLED: 'danger' };
const FREIGHT_LABEL: Record<string, string> = { CIF: 'CIF', FOB: 'FOB', THIRD_PARTY: 'Terceiros', TO_DEFINE: 'A definir' };

function BalanceBar({ c }: { c: ContractListItem }) {
  const b = c.balances;
  const unit = c.unit.code === 'T' ? 't' : c.unit.code.toLowerCase();
  return (
    <Tooltip
      content={
        <span className="grid grid-cols-[auto_auto] gap-x-4 tabular">
          <span>Contratado</span>
          <span className="text-right">{formatQty(b.contracted, unit)}</span>
          <span>Em ordens</span>
          <span className="text-right">{formatQty(b.committed, unit)}</span>
          <span>Carregado</span>
          <span className="text-right">{formatQty(b.loaded, unit)}</span>
          <span>Recebido</span>
          <span className="text-right">{formatQty(b.received, unit)}</span>
          <span className="font-medium">Saldo</span>
          <span className="text-right font-medium">{formatQty(b.balance, unit)}</span>
        </span>
      }
    >
      <div className="space-y-1.5">
        <div className="flex items-baseline justify-between gap-2 tabular">
          <span className="font-medium">{formatQty(b.contracted, unit)}</span>
          <span className="text-[11px] text-subtle">saldo {formatQty(b.balance, unit)}</span>
        </div>
        <div className="flex h-1.5 overflow-hidden rounded-full bg-surface-3" aria-hidden>
          <div className="h-full bg-success" style={{ width: `${ratio(b.loaded, b.contracted)}%` }} />
          <div className="h-full bg-primary/50" style={{ width: `${Math.max(0, ratio(b.committed, b.contracted) - ratio(b.loaded, b.contracted))}%` }} />
        </div>
      </div>
    </Tooltip>
  );
}

type Values = {
  number: string;
  seller: ComboOption | null;
  buyer: ComboOption | null;
  commodity: ComboOption | null;
  cropYear: string;
  quantity: string;
  unitId: string;
  unitPrice: string;
  currency: 'BRL' | 'USD';
  startsOn: string;
  endsOn: string;
  freightMode: string;
  terms: string;
  notes: string;
  status: ContractStatus;
};

const empty = (): Values => ({ number: '', seller: null, buyer: null, commodity: null, cropYear: '', quantity: '', unitId: '', unitPrice: '', currency: 'BRL', startsOn: '', endsOn: '', freightMode: '', terms: '', notes: '', status: 'ACTIVE' });

function ContractDrawer({ id, open, onClose }: { id: string | null; open: boolean; onClose: () => void }) {
  const can = useCan();
  const readOnly = !can('contract.manage');
  const invalidate = useInvalidateRegistry();
  const units = useUnits();
  const detail = useQuery({ queryKey: ['registry', 'contract', id], queryFn: () => get<ContractDetail>(`/contracts/${id}`), enabled: Boolean(id && open) });
  const c = detail.data;
  const form = useForm<Values>({ defaultValues: empty() });
  const errors = form.formState.errors;
  const [quantity, unitPrice, currency, unitId] = useWatch({ control: form.control, name: ['quantity', 'unitPrice', 'currency', 'unitId'] });
  const total = useMemo(() => mulDec(parseDecimalInput(quantity), parseDecimalInput(unitPrice), 2), [quantity, unitPrice]);
  const locked = Boolean(c?.ordersCount);

  useEffect(() => {
    if (!open) return;
    if (id && c) {
      form.reset({
        number: c.number,
        seller: { id: c.seller.id, label: c.seller.name },
        buyer: { id: c.buyer.id, label: c.buyer.name },
        commodity: { id: c.commodity.id, label: c.commodity.name },
        cropYear: c.cropYear ?? '',
        quantity: toDecimalInput(c.balances.contracted),
        unitId: c.unit.id,
        unitPrice: toDecimalInput(c.unitPrice),
        currency: c.currency as 'BRL' | 'USD',
        startsOn: c.startsOn ?? '',
        endsOn: c.endsOn ?? '',
        freightMode: c.freightMode ?? '',
        terms: c.terms ?? '',
        notes: c.notes ?? '',
        status: c.status,
      });
    } else if (!id) {
      const t = units.data?.find((u) => u.meta?.code === 'T');
      form.reset({ ...empty(), unitId: t?.id ?? '' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, id, c?.updatedAt, units.data]);

  const submit = form.handleSubmit(async (v) => {
    const payload = {
      number: v.number,
      sellerPartnerId: v.seller?.id ?? '',
      buyerPartnerId: v.buyer?.id ?? '',
      commodityId: v.commodity?.id ?? '',
      cropYear: v.cropYear,
      quantity: parseDecimalInput(v.quantity),
      unitId: v.unitId,
      unitPrice: v.unitPrice ? parseDecimalInput(v.unitPrice) : '',
      currency: v.currency,
      startsOn: v.startsOn,
      endsOn: v.endsOn,
      freightMode: v.freightMode,
      terms: v.terms,
      notes: v.notes,
      status: v.status,
    };
    const map = (k: string) => ({ sellerPartnerId: 'seller', buyerPartnerId: 'buyer', commodityId: 'commodity' })[k] ?? k;
    const parsed = contractInputSchema.safeParse(payload);
    if (!parsed.success) return parsed.error.issues.forEach((i) => form.setError(map(String(i.path[0])) as keyof Values, { message: i.message }));
    try {
      const saved = id ? await put<ContractDetail>(`/contracts/${id}`, parsed.data) : await post<ContractDetail>('/contracts', parsed.data);
      toast.success(id ? 'Contrato atualizado' : `Contrato ${saved.number} criado`);
      invalidate('contracts');
      invalidate('contract');
      onClose();
    } catch (err) {
      handleSaveError(err, (n, e) => form.setError(map(String(n)) as keyof Values, e));
    }
  });

  const unitLabel = units.data?.find((u) => u.id === unitId)?.label ?? '';

  return (
    <Drawer
      open={open}
      onRequestClose={onClose}
      title={id ? (c ? `Contrato ${c.number}` : 'Carregando…') : 'Novo contrato'}
      subtitle={c ? `${c.seller.name} → ${c.buyer.name} · ${c.commodity.name}${c.cropYear ? ` ${c.cropYear}` : ''}` : 'O número é gerado automaticamente se ficar em branco.'}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            {readOnly ? 'Fechar' : 'Cancelar'}
          </Button>
          {!readOnly ? (
            <Button onClick={() => void submit()} loading={form.formState.isSubmitting}>
              <Check /> Salvar
            </Button>
          ) : null}
        </div>
      }
    >
      {id && !c ? (
        <div className="space-y-4 p-7">
          <Skeleton className="h-24" />
          <Skeleton className="h-72" />
        </div>
      ) : (
        <form onSubmit={submit} noValidate>
          <fieldset disabled={readOnly} className="contents">
            {c ? (
              <div className="space-y-3 px-5 pt-5 sm:px-7">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <Stat label="Em ordens" value={formatQty(c.balances.committed, 't')} />
                  <Stat label="Carregado" value={formatQty(c.balances.loaded, 't')} />
                  <Stat label="Saldo físico" value={formatQty(c.balances.balance, 't')} />
                  <Stat label="Saldo financeiro" value={c.balances.valueBalance ? formatMoney(c.balances.valueBalance, c.currency, true) : '—'} />
                </div>
                <Card className="p-3">
                  <BalanceBar c={c} />
                </Card>
              </div>
            ) : null}

            <FormSection title="Partes e produto" description={locked ? 'Partes, commodity e unidade ficam travadas porque o contrato já possui ordens.' : undefined}>
              <Field label="Número" className={span[2]} error={errors.number?.message}>
                {(a) => <Input {...a} className="font-mono uppercase" placeholder="Automático" {...form.register('number')} />}
              </Field>
              <Field label="Status" className={span[2]}>
                {(a) => <Select {...a} {...form.register('status')} options={CONTRACT_STATUSES.map((s) => ({ value: s, label: CONTRACT_STATUS_LABELS[s] }))} />}
              </Field>
              <Field label="Safra" className={span[2]} error={errors.cropYear?.message}>
                {(a) => <Input {...a} placeholder="25/26" {...form.register('cropYear')} />}
              </Field>
              <Field label="Vendedor" required className={span[3]} error={errors.seller?.message}>
                {(a) => <Controller control={form.control} name="seller" render={({ field }) => <AsyncCombobox {...a} value={field.value} onChange={field.onChange} disabled={locked} queryKey={['lookup', 'sellers', null]} fetchPage={lookups.sellers()} placeholder="Pesquisar vendedor…" />} />}
              </Field>
              <Field label="Comprador" required className={span[3]} error={errors.buyer?.message}>
                {(a) => <Controller control={form.control} name="buyer" render={({ field }) => <AsyncCombobox {...a} value={field.value} onChange={field.onChange} disabled={locked} queryKey={['lookup', 'buyers', null]} fetchPage={lookups.buyers()} placeholder="Pesquisar comprador…" />} />}
              </Field>
              <Field label="Commodity" required className={span[3]} error={errors.commodity?.message}>
                {(a) => <Controller control={form.control} name="commodity" render={({ field }) => <AsyncCombobox {...a} value={field.value} onChange={field.onChange} disabled={locked} queryKey={['lookup', 'commodities', null]} fetchPage={lookups.commodities()} placeholder="Milho, soja…" />} />}
              </Field>
              <Field label="Modalidade de frete" className={span[3]}>
                {(a) => <Select {...a} {...form.register('freightMode')} placeholder="—" options={FREIGHT_MODES.map((f) => ({ value: f, label: FREIGHT_LABEL[f] ?? f }))} />}
              </Field>
            </FormSection>

            <FormSection title="Quantidade e valores">
              <Field label="Quantidade contratada" required className={span[2]} error={errors.quantity?.message}>
                {(a) => <Input {...a} inputMode="decimal" className="text-right tabular" {...form.register('quantity')} />}
              </Field>
              <Field label="Unidade" required className={span[1]} error={errors.unitId?.message}>
                {(a) => <Select {...a} disabled={locked} {...form.register('unitId')} options={(units.data ?? []).map((u) => ({ value: u.id, label: u.label }))} />}
              </Field>
              <Field label={`Preço${unitLabel ? ` / ${unitLabel}` : ''}`} className={span[2]} error={errors.unitPrice?.message}>
                {(a) => <Input {...a} inputMode="decimal" className="text-right tabular" {...form.register('unitPrice')} />}
              </Field>
              <Field label="Moeda" className={span[1]}>
                {(a) => <Select {...a} {...form.register('currency')} options={[{ value: 'BRL', label: 'BRL' }, { value: 'USD', label: 'USD' }]} />}
              </Field>
              <div className="flex h-[58px] items-center justify-between rounded-lg bg-primary-soft/60 px-4 ring-1 ring-primary/15 sm:col-span-6">
                <span className="text-[12.5px] font-medium text-muted">Valor total do contrato</span>
                <span className="text-lg font-semibold text-primary tabular">{total ? formatMoney(total, currency) : '—'}</span>
              </div>
              <Field label="Início" className={span[3]}>
                {(a) => <Input {...a} type="date" {...form.register('startsOn')} />}
              </Field>
              <Field label="Término" className={span[3]} error={errors.endsOn?.message}>
                {(a) => <Input {...a} type="date" {...form.register('endsOn')} />}
              </Field>
            </FormSection>

            <FormSection title="Condições">
              <Field label="Condições comerciais" className={span[6]}>
                {(a) => <Textarea {...a} rows={3} {...form.register('terms')} />}
              </Field>
              <Field label="Observações" className={span[6]}>
                {(a) => <Textarea {...a} rows={2} {...form.register('notes')} />}
              </Field>
            </FormSection>

            {c?.orders.length ? (
              <FormSection title={`Ordens do contrato (${c.orders.length})`}>
                <ul className="divide-y divide-border/60 sm:col-span-6">
                  {c.orders.map((o) => (
                    <li key={o.id}>
                      <Link href={`/ordens/${o.id}`} className="flex items-center gap-3 py-2.5 text-sm hover:text-primary">
                        <span className="font-mono">{o.number}</span>
                        <StatusBadge status={o.status as never} size="sm" />
                        <span className="ml-auto tabular text-muted">
                          {formatQty(o.quantity, 't')} · carregado {formatQty(o.loaded, 't')}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </FormSection>
            ) : null}
          </fieldset>
        </form>
      )}
    </Drawer>
  );
}

export function ContractsPage() {
  const can = useCan();
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  return (
    <>
      <RegistryList<ContractListItem>
        title="Contratos"
        description="Quantidades contratadas, comprometidas em ordens e saldos físico e financeiro."
        icon={<FileSignature />}
        endpoint="/contracts"
        queryKey="contracts"
        searchPlaceholder="Buscar por número, parte, commodity ou safra…"
        createLabel="Novo contrato"
        onCreate={can('contract.manage') ? () => setCreating(true) : undefined}
        onOpen={(r) => setOpenId(r.id)}
        columns={[
          { key: 'number', header: 'Contrato', width: '150px', render: (c) => <span className="font-mono text-[13px] font-medium">{c.number}</span> },
          {
            key: 'parties',
            header: 'Vendedor → Comprador',
            render: (c) => (
              <div className="min-w-0">
                <div className="truncate">{c.seller.name}</div>
                <div className="truncate text-xs text-subtle">→ {c.buyer.name}</div>
              </div>
            ),
          },
          { key: 'commodity', header: 'Commodity', width: '160px', render: (c) => `${c.commodity.name}${c.cropYear ? ` · ${c.cropYear}` : ''}` },
          { key: 'balance', header: 'Quantidade · saldo', width: '240px', render: (c) => <BalanceBar c={c} /> },
          {
            key: 'value',
            header: 'Valor',
            width: '150px',
            align: 'right',
            render: (c) => (
              <div className="tabular">
                <div>{c.balances.totalValue ? formatMoney(c.balances.totalValue, c.currency, true) : '—'}</div>
                <div className="text-[11px] text-subtle">{c.unitPrice ? `${formatMoney(c.unitPrice, c.currency)}/${c.unit.code.toLowerCase()}` : ''}</div>
              </div>
            ),
          },
          { key: 'period', header: 'Vigência', width: '190px', render: (c) => (c.startsOn ? `${formatDate(c.startsOn)} – ${formatDate(c.endsOn)}` : '—') },
          { key: 'orders', header: 'Ordens', width: '80px', align: 'right', render: (c) => <span className="tabular">{c.ordersCount}</span> },
          { key: 'status', header: 'Status', width: '110px', render: (c) => <Badge size="sm" tone={TONE[c.status]}>{CONTRACT_STATUS_LABELS[c.status]}</Badge> },
        ]}
        renderCard={(c) => (
          <div className="space-y-2">
            <div className="flex justify-between gap-2">
              <span className="font-mono font-medium">{c.number}</span>
              <Badge size="sm" tone={TONE[c.status]}>
                {CONTRACT_STATUS_LABELS[c.status]}
              </Badge>
            </div>
            <div className="text-xs text-muted">
              {c.seller.name} → {c.buyer.name} · {c.commodity.name}
            </div>
            <BalanceBar c={c} />
          </div>
        )}
      />
      <ContractDrawer id={openId} open={Boolean(openId) || creating} onClose={() => (setOpenId(null), setCreating(false))} />
    </>
  );
}
