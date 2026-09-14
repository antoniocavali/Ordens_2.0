'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import {
  commodityInputSchema,
  driverInputSchema,
  formatDocument,
  VEHICLE_TYPE_LABELS,
  VEHICLE_TYPES,
  vehicleInputSchema,
  type CommodityListItem,
  type DriverListItem,
  type VehicleListItem,
} from '@ordens/contracts';
import { AsyncCombobox, Badge, Button, Drawer, Field, Input, Select, Textarea, type ComboOption } from '@ordens/ui';
import { AlertTriangle, Archive, Check, IdCard, Truck, Wheat } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { toast } from 'sonner';
import type { z } from 'zod';
import { lookups, useUnits } from '@/features/orders/orders-api';
import { get, post, put } from '@/lib/api';
import { formatDate, formatQty, parseDecimalInput, toDecimalInput } from '@/lib/format';
import { useCan } from '@/lib/session';
import { FormSection, formatPhone, handleSaveError, span, useInvalidateRegistry } from './form-utils';
import { RegistryList, StatusPill } from './registry-list';

const STATUS_OPTS = [
  { value: 'ACTIVE', label: 'Ativo' },
  { value: 'INACTIVE', label: 'Inativo' },
  { value: 'BLOCKED', label: 'Bloqueado' },
];

function FormFooter({ readOnly, onClose, onSave, saving, onArchive }: { readOnly: boolean; onClose: () => void; onSave: () => void; saving: boolean; onArchive?: () => void }) {
  return (
    <div className="flex items-center gap-2">
      {onArchive && !readOnly ? (
        <Button variant="ghost" onClick={onArchive}>
          <Archive /> Arquivar
        </Button>
      ) : null}
      <div className="ml-auto flex gap-2">
        <Button variant="ghost" onClick={onClose}>
          {readOnly ? 'Fechar' : 'Cancelar'}
        </Button>
        {!readOnly ? (
          <Button onClick={onSave} loading={saving}>
            <Check /> Salvar
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function useCarrierFilter() {
  const params = useSearchParams();
  return params.get('transportadora') ?? undefined;
}

// ───────────────────────────── Motoristas ─────────────────────────────

type DriverValues = Omit<z.input<typeof driverInputSchema>, 'carrierPartnerId'> & { carrier: ComboOption | null };

function DriverDrawer({ row, open, onClose }: { row: DriverListItem | null; open: boolean; onClose: () => void }) {
  const can = useCan();
  const readOnly = !can('carrier.manage');
  const invalidate = useInvalidateRegistry();
  const form = useForm<DriverValues>();
  const errors = form.formState.errors;

  useEffect(() => {
    if (!open) return;
    if (!row) {
      form.reset({ carrier: null, name: '', cpf: '', phone: '', email: '', cnhNumber: '', cnhCategory: '', cnhExpiresAt: '', notes: '', status: 'ACTIVE' });
      return;
    }
    void get<Record<string, string | null> & { carrier: { id: string; name: string } | null }>(`/drivers/${row.id}`).then((d) =>
      form.reset({
        carrier: d.carrier ? { id: d.carrier.id, label: d.carrier.name } : null,
        name: d.name ?? '',
        cpf: formatDocument(d.cpf ?? ''),
        phone: d.phone ?? '',
        email: d.email ?? '',
        cnhNumber: d.cnhNumber ?? '',
        cnhCategory: (d.cnhCategory ?? '') as DriverValues['cnhCategory'],
        cnhExpiresAt: d.cnhExpiresAt ?? '',
        notes: d.notes ?? '',
        status: (d.status ?? 'ACTIVE') as DriverValues['status'],
      }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, row?.id]);

  const submit = form.handleSubmit(async ({ carrier, ...rest }) => {
    const parsed = driverInputSchema.safeParse({ ...rest, carrierPartnerId: carrier?.id ?? null });
    if (!parsed.success) return parsed.error.issues.forEach((i) => form.setError(i.path.join('.') as keyof DriverValues, { message: i.message }));
    try {
      if (row) await put(`/drivers/${row.id}`, parsed.data);
      else await post('/drivers', parsed.data);
      toast.success(row ? 'Motorista atualizado' : 'Motorista cadastrado');
      invalidate('drivers');
      onClose();
    } catch (err) {
      handleSaveError(err, (n, e) => form.setError((n === 'carrierPartnerId' ? 'carrier' : n) as keyof DriverValues, e));
    }
  });

  return (
    <Drawer
      open={open}
      size="md"
      onRequestClose={onClose}
      title={row ? row.name : 'Novo motorista'}
      subtitle={row ? `CPF ${formatDocument(row.cpf)}` : 'O motorista é escolhido no agendamento de cada carga.'}
      footer={
        <FormFooter
          readOnly={readOnly}
          onClose={onClose}
          onSave={() => void submit()}
          saving={form.formState.isSubmitting}
          onArchive={
            row
              ? async () => {
                  await post(`/drivers/${row.id}/archive`);
                  toast.success('Motorista arquivado');
                  invalidate('drivers');
                  onClose();
                }
              : undefined
          }
        />
      }
    >
      <form onSubmit={submit} noValidate>
        <fieldset disabled={readOnly} className="contents">
          <FormSection title="Identificação">
            <Field label="Nome completo" required className={span[6]} error={errors.name?.message}>
              {(a) => <Input {...a} {...form.register('name')} />}
            </Field>
            <Field label="CPF" required className={span[3]} error={errors.cpf?.message}>
              {(a) => <Input {...a} inputMode="numeric" className="font-mono" {...form.register('cpf')} />}
            </Field>
            <Field label="Status" className={span[3]}>
              {(a) => <Select {...a} {...form.register('status')} options={STATUS_OPTS} />}
            </Field>
            <Field label="Telefone" className={span[3]} error={errors.phone?.message}>
              {(a) => <Input {...a} {...form.register('phone')} />}
            </Field>
            <Field label="E-mail" className={span[3]} error={errors.email?.message}>
              {(a) => <Input {...a} {...form.register('email')} />}
            </Field>
            <Field label="Transportadora" className={span[6]} error={errors.carrier?.message} hint="Opcional para motoristas autônomos">
              {(a) => (
                <Controller control={form.control} name="carrier" render={({ field }) => <AsyncCombobox {...a} value={field.value} onChange={field.onChange} queryKey={['lookup', 'carriers']} fetchPage={lookups.carriers()} placeholder="Pesquisar transportadora…" />} />
              )}
            </Field>
          </FormSection>
          <FormSection title="CNH">
            <Field label="Número" className={span[2]} error={errors.cnhNumber?.message}>
              {(a) => <Input {...a} inputMode="numeric" className="font-mono" {...form.register('cnhNumber')} />}
            </Field>
            <Field label="Categoria" className={span[2]}>
              {(a) => <Select {...a} {...form.register('cnhCategory')} placeholder="—" options={['A', 'B', 'C', 'D', 'E', 'AB', 'AC', 'AD', 'AE'].map((v) => ({ value: v, label: v }))} />}
            </Field>
            <Field label="Validade" className={span[2]}>
              {(a) => <Input {...a} type="date" {...form.register('cnhExpiresAt')} />}
            </Field>
            <Field label="Observações" className={span[6]}>
              {(a) => <Textarea {...a} rows={3} {...form.register('notes')} />}
            </Field>
          </FormSection>
        </fieldset>
      </form>
    </Drawer>
  );
}

const CNH_BADGE = {
  OK: null,
  EXPIRING: { tone: 'warning' as const, label: 'Vence em breve' },
  EXPIRED: { tone: 'danger' as const, label: 'CNH vencida' },
  UNKNOWN: { tone: 'neutral' as const, label: 'Sem validade' },
};

export function DriversPage() {
  const can = useCan();
  const carrier = useCarrierFilter();
  const [open, setOpen] = useState<DriverListItem | null | 'new'>(null);
  return (
    <>
      <RegistryList<DriverListItem>
        title="Motoristas"
        description="Motoristas das transportadoras e autônomos."
        icon={<IdCard />}
        endpoint="/drivers"
        queryKey="drivers"
        query={{ partnerId: carrier }}
        searchPlaceholder="Buscar por nome, CPF ou telefone…"
        createLabel="Novo motorista"
        onCreate={can('carrier.manage') ? () => setOpen('new') : undefined}
        onOpen={(r) => setOpen(r)}
        columns={[
          { key: 'name', header: 'Nome', render: (d) => <span className="font-medium">{d.name}</span> },
          { key: 'cpf', header: 'CPF', width: '160px', render: (d) => <span className="font-mono text-[13px]">{formatDocument(d.cpf)}</span> },
          { key: 'phone', header: 'Telefone', width: '160px', render: (d) => formatPhone(d.phone) },
          { key: 'carrier', header: 'Transportadora', render: (d) => d.carrier?.name ?? <span className="text-subtle">Autônomo</span> },
          {
            key: 'cnh',
            header: 'CNH',
            width: '290px',
            render: (d) => {
              const badge = CNH_BADGE[d.cnhStatus];
              return (
                <span className="flex items-center gap-2 whitespace-nowrap">
                  <span className="tabular">
                    {d.cnhCategory ?? '—'} · {formatDate(d.cnhExpiresAt)}
                  </span>
                  {badge ? (
                    <Badge size="sm" tone={badge.tone}>
                      {d.cnhStatus === 'EXPIRED' ? <AlertTriangle /> : null}
                      {badge.label}
                    </Badge>
                  ) : null}
                </span>
              );
            },
          },
          { key: 'status', header: 'Status', width: '100px', render: (d) => <StatusPill status={d.status} /> },
        ]}
        renderCard={(d) => (
          <div className="space-y-1">
            <div className="flex justify-between gap-2">
              <span className="font-medium">{d.name}</span>
              <StatusPill status={d.status} />
            </div>
            <div className="text-xs text-muted">
              {d.carrier?.name ?? 'Autônomo'} · CNH {d.cnhCategory ?? '—'} {formatDate(d.cnhExpiresAt)}
            </div>
          </div>
        )}
      />
      <DriverDrawer row={open === 'new' ? null : open} open={open !== null} onClose={() => setOpen(null)} />
    </>
  );
}

// ───────────────────────────── Veículos ─────────────────────────────

type VehicleValues = Omit<z.input<typeof vehicleInputSchema>, 'carrierPartnerId'> & { carrier: ComboOption | null };

function VehicleDrawer({ row, open, onClose }: { row: VehicleListItem | null; open: boolean; onClose: () => void }) {
  const can = useCan();
  const readOnly = !can('carrier.manage');
  const invalidate = useInvalidateRegistry();
  const form = useForm<VehicleValues>();
  const errors = form.formState.errors;

  useEffect(() => {
    if (!open) return;
    form.reset(
      row
        ? {
            carrier: row.carrier ? { id: row.carrier.id, label: row.carrier.name } : null,
            plate: row.plate,
            type: row.type,
            capacityKg: toDecimalInput(row.capacityKg),
            axles: row.axles ?? '',
            brand: row.brand ?? '',
            model: row.model ?? '',
            year: row.year ?? '',
            renavam: row.renavam ?? '',
            notes: row.notes ?? '',
            status: row.status,
          }
        : { carrier: null, plate: '', type: 'TRUCK_TRACTOR', capacityKg: '', axles: '', brand: '', model: '', year: '', renavam: '', notes: '', status: 'ACTIVE' },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, row?.id]);

  const submit = form.handleSubmit(async ({ carrier, ...rest }) => {
    const parsed = vehicleInputSchema.safeParse({ ...rest, capacityKg: rest.capacityKg ? parseDecimalInput(String(rest.capacityKg)) : '', carrierPartnerId: carrier?.id ?? null });
    if (!parsed.success) return parsed.error.issues.forEach((i) => form.setError(i.path.join('.') as keyof VehicleValues, { message: i.message }));
    try {
      if (row) await put(`/vehicles/${row.id}`, parsed.data);
      else await post('/vehicles', parsed.data);
      toast.success(row ? 'Veículo atualizado' : 'Veículo cadastrado', { description: parsed.data.plate });
      invalidate('vehicles');
      onClose();
    } catch (err) {
      handleSaveError(err, (n, e) => form.setError((n === 'carrierPartnerId' ? 'carrier' : n) as keyof VehicleValues, e));
    }
  });

  return (
    <Drawer
      open={open}
      size="md"
      onRequestClose={onClose}
      title={row ? <span className="font-mono">{row.plate}</span> : 'Novo veículo'}
      subtitle={row ? VEHICLE_TYPE_LABELS[row.type] : 'Cavalo, carreta ou composição. A combinação é definida no agendamento.'}
      footer={
        <FormFooter
          readOnly={readOnly}
          onClose={onClose}
          onSave={() => void submit()}
          saving={form.formState.isSubmitting}
          onArchive={
            row
              ? async () => {
                  await post(`/vehicles/${row.id}/archive`);
                  toast.success('Veículo arquivado');
                  invalidate('vehicles');
                  onClose();
                }
              : undefined
          }
        />
      }
    >
      <form onSubmit={submit} noValidate>
        <fieldset disabled={readOnly} className="contents">
          <FormSection title="Veículo">
            <Field label="Placa" required className={span[2]} error={errors.plate?.message}>
              {(a) => <Input {...a} className="font-mono uppercase" placeholder="ABC1D23" {...form.register('plate')} />}
            </Field>
            <Field label="Tipo" required className={span[4]}>
              {(a) => <Select {...a} {...form.register('type')} options={VEHICLE_TYPES.map((t) => ({ value: t, label: VEHICLE_TYPE_LABELS[t] }))} />}
            </Field>
            <Field label="Transportadora" className={span[6]} error={errors.carrier?.message}>
              {(a) => (
                <Controller control={form.control} name="carrier" render={({ field }) => <AsyncCombobox {...a} value={field.value} onChange={field.onChange} queryKey={['lookup', 'carriers']} fetchPage={lookups.carriers()} placeholder="Pesquisar transportadora…" />} />
              )}
            </Field>
            <Field label="Capacidade (kg)" className={span[2]} error={errors.capacityKg?.message}>
              {(a) => <Input {...a} inputMode="decimal" className="text-right tabular" {...form.register('capacityKg')} />}
            </Field>
            <Field label="Eixos" className={span[2]} error={errors.axles?.message}>
              {(a) => <Input {...a} inputMode="numeric" {...form.register('axles')} />}
            </Field>
            <Field label="Ano" className={span[2]} error={errors.year?.message}>
              {(a) => <Input {...a} inputMode="numeric" {...form.register('year')} />}
            </Field>
            <Field label="Marca" className={span[3]}>
              {(a) => <Input {...a} {...form.register('brand')} />}
            </Field>
            <Field label="Modelo" className={span[3]}>
              {(a) => <Input {...a} {...form.register('model')} />}
            </Field>
            <Field label="RENAVAM" className={span[3]} error={errors.renavam?.message}>
              {(a) => <Input {...a} inputMode="numeric" className="font-mono" {...form.register('renavam')} />}
            </Field>
            <Field label="Status" className={span[3]}>
              {(a) => <Select {...a} {...form.register('status')} options={STATUS_OPTS} />}
            </Field>
            <Field label="Observações" className={span[6]}>
              {(a) => <Textarea {...a} rows={3} {...form.register('notes')} />}
            </Field>
          </FormSection>
        </fieldset>
      </form>
    </Drawer>
  );
}

export function VehiclesPage() {
  const can = useCan();
  const carrier = useCarrierFilter();
  const [open, setOpen] = useState<VehicleListItem | null | 'new'>(null);
  return (
    <>
      <RegistryList<VehicleListItem>
        title="Veículos"
        description="Cavalos mecânicos, carretas e composições das transportadoras."
        icon={<Truck />}
        endpoint="/vehicles"
        queryKey="vehicles"
        query={{ partnerId: carrier }}
        searchPlaceholder="Buscar por placa, marca ou modelo…"
        createLabel="Novo veículo"
        onCreate={can('carrier.manage') ? () => setOpen('new') : undefined}
        onOpen={(r) => setOpen(r)}
        columns={[
          { key: 'plate', header: 'Placa', width: '130px', render: (v) => <span className="rounded bg-surface-2 px-2 py-1 font-mono text-[13px] font-semibold tracking-wider ring-1 ring-border">{v.plate}</span> },
          { key: 'type', header: 'Tipo', width: '180px', render: (v) => VEHICLE_TYPE_LABELS[v.type] },
          { key: 'model', header: 'Marca / modelo', render: (v) => [v.brand, v.model, v.year].filter(Boolean).join(' · ') || <span className="text-subtle">—</span> },
          { key: 'carrier', header: 'Transportadora', render: (v) => v.carrier?.name ?? <span className="text-subtle">—</span> },
          { key: 'capacity', header: 'Capacidade', width: '130px', align: 'right', render: (v) => (v.capacityKg ? formatQty(v.capacityKg, 'kg') : '—') },
          { key: 'status', header: 'Status', width: '100px', render: (v) => <StatusPill status={v.status} /> },
        ]}
        renderCard={(v) => (
          <div className="space-y-1">
            <div className="flex justify-between gap-2">
              <span className="font-mono font-semibold">{v.plate}</span>
              <StatusPill status={v.status} />
            </div>
            <div className="text-xs text-muted">
              {VEHICLE_TYPE_LABELS[v.type]} · {v.carrier?.name ?? 'Sem transportadora'}
            </div>
          </div>
        )}
      />
      <VehicleDrawer row={open === 'new' ? null : open} open={open !== null} onClose={() => setOpen(null)} />
    </>
  );
}

// ───────────────────────────── Commodities ─────────────────────────────

type CommodityValues = z.input<typeof commodityInputSchema>;

function CommodityDrawer({ row, open, onClose }: { row: CommodityListItem | null; open: boolean; onClose: () => void }) {
  const can = useCan();
  const readOnly = !can('commodity.manage');
  const invalidate = useInvalidateRegistry();
  const units = useUnits();
  const form = useForm<CommodityValues, unknown, z.output<typeof commodityInputSchema>>({ resolver: zodResolver(commodityInputSchema) });
  const errors = form.formState.errors;

  useEffect(() => {
    if (!open) return;
    form.reset(
      row
        ? { code: row.code, name: row.name, category: row.category ?? '', defaultUnitId: row.defaultUnit?.id ?? null, description: row.description ?? '', status: row.status }
        : { code: '', name: '', category: '', defaultUnitId: null, description: '', status: 'ACTIVE' },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, row?.id]);

  const submit = form.handleSubmit(async (values) => {
    try {
      if (row) await put(`/commodities/${row.id}`, values);
      else await post('/commodities', values);
      toast.success(row ? 'Commodity atualizada' : 'Commodity cadastrada');
      invalidate('commodities');
      onClose();
    } catch (err) {
      handleSaveError(err, form.setError);
    }
  });

  return (
    <Drawer open={open} size="md" onRequestClose={onClose} title={row ? row.name : 'Nova commodity'} footer={<FormFooter readOnly={readOnly} onClose={onClose} onSave={() => void submit()} saving={form.formState.isSubmitting} />}>
      <form onSubmit={submit} noValidate>
        <fieldset disabled={readOnly} className="contents">
          <FormSection title="Produto">
            <Field label="Código" required className={span[2]} error={errors.code?.message}>
              {(a) => <Input {...a} className="font-mono uppercase" {...form.register('code')} />}
            </Field>
            <Field label="Nome" required className={span[4]} error={errors.name?.message}>
              {(a) => <Input {...a} {...form.register('name')} />}
            </Field>
            <Field label="Categoria" className={span[3]}>
              {(a) => <Input {...a} {...form.register('category')} placeholder="Grãos, fibras…" />}
            </Field>
            <Field label="Unidade padrão" className={span[3]}>
              {(a) => (
                <Select
                  {...a}
                  {...form.register('defaultUnitId', { setValueAs: (v: string) => v || null })}
                  placeholder="—"
                  options={(units.data ?? []).map((u) => ({ value: u.id, label: `${u.label} · ${u.description}` }))}
                />
              )}
            </Field>
            <Field label="Status" className={span[3]}>
              {(a) => <Select {...a} {...form.register('status')} options={STATUS_OPTS} />}
            </Field>
            <Field label="Descrição" className={span[6]}>
              {(a) => <Textarea {...a} rows={3} {...form.register('description')} />}
            </Field>
          </FormSection>
        </fieldset>
      </form>
    </Drawer>
  );
}

export function CommoditiesPage() {
  const can = useCan();
  const [open, setOpen] = useState<CommodityListItem | null | 'new'>(null);
  return (
    <>
      <RegistryList<CommodityListItem>
        title="Commodities"
        description="Produtos negociados e unidade padrão de cada um."
        icon={<Wheat />}
        endpoint="/commodities"
        queryKey="commodities"
        searchPlaceholder="Buscar por nome, código ou categoria…"
        createLabel="Nova commodity"
        onCreate={can('commodity.manage') ? () => setOpen('new') : undefined}
        onOpen={(r) => setOpen(r)}
        columns={[
          { key: 'code', header: 'Código', width: '140px', render: (c) => <span className="font-mono text-[13px]">{c.code}</span> },
          { key: 'name', header: 'Nome', render: (c) => <span className="font-medium">{c.name}</span> },
          { key: 'category', header: 'Categoria', render: (c) => c.category ?? <span className="text-subtle">—</span> },
          { key: 'unit', header: 'Unidade', width: '110px', render: (c) => c.defaultUnit?.code ?? '—' },
          { key: 'orders', header: 'Ordens', width: '90px', align: 'right', render: (c) => <span className="tabular">{c.ordersCount}</span> },
          { key: 'status', header: 'Status', width: '100px', render: (c) => <StatusPill status={c.status} /> },
        ]}
        renderCard={(c) => (
          <div className="flex justify-between gap-2">
            <span>
              <span className="font-medium">{c.name}</span> <span className="font-mono text-xs text-muted">{c.code}</span>
            </span>
            <StatusPill status={c.status} />
          </div>
        )}
      />
      <CommodityDrawer row={open === 'new' ? null : open} open={open !== null} onClose={() => setOpen(null)} />
    </>
  );
}
