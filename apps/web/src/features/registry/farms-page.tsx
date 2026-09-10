'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { farmInputSchema, UF, type FarmDetail, type FarmListItem } from '@ordens/contracts';
import { AsyncCombobox, Button, Drawer, Field, Input, Select, Skeleton, Textarea, Tooltip, type ComboOption } from '@ordens/ui';
import { useQuery } from '@tanstack/react-query';
import { Archive, ArchiveRestore, Check, MapPin, MapPinOff, Sprout } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { toast } from 'sonner';
import type { z } from 'zod';
import { lookups } from '@/features/orders/orders-api';
import { get, post, put } from '@/lib/api';
import { formatQty, toDecimalInput, parseDecimalInput } from '@/lib/format';
import { useCan } from '@/lib/session';
import { FormSection, handleSaveError, span, Stat, useInvalidateRegistry } from './form-utils';
import { RegistryList, StatusPill } from './registry-list';

type Values = Omit<z.input<typeof farmInputSchema>, 'ownerPartnerId'> & { owner: ComboOption | null };

const empty = (owner: ComboOption | null = null): Values => ({
  owner,
  name: '',
  code: '',
  stateRegistration: '',
  zipCode: '',
  address: '',
  city: '',
  state: '',
  latitude: '',
  longitude: '',
  loadingPoint: '',
  operatingHours: '',
  dailyCapacity: '',
  accessRestrictions: '',
  carrierInstructions: '',
  contactName: '',
  contactPhone: '',
  notes: '',
  status: 'ACTIVE',
});

const fromDetail = (f: FarmDetail): Values => ({
  owner: { id: f.owner.id, label: f.owner.name },
  name: f.name,
  code: f.code ?? '',
  stateRegistration: f.stateRegistration ?? '',
  zipCode: f.zipCode ?? '',
  address: f.address ?? '',
  city: f.city ?? '',
  state: (f.state ?? '') as Values['state'],
  latitude: f.latitude ?? '',
  longitude: f.longitude ?? '',
  loadingPoint: f.loadingPoint ?? '',
  operatingHours: f.operatingHours ?? '',
  dailyCapacity: toDecimalInput(f.dailyCapacity),
  accessRestrictions: f.accessRestrictions ?? '',
  carrierInstructions: f.carrierInstructions ?? '',
  contactName: f.contactName ?? '',
  contactPhone: f.contactPhone ?? '',
  notes: f.notes ?? '',
  status: f.status,
});

function FarmDrawer({ id, open, initialOwner, onClose }: { id: string | null; open: boolean; initialOwner: ComboOption | null; onClose: () => void }) {
  const can = useCan();
  const readOnly = !can('farm.manage');
  const invalidate = useInvalidateRegistry();
  const detail = useQuery({ queryKey: ['registry', 'farm', id], queryFn: () => get<FarmDetail>(`/farms/${id}`), enabled: Boolean(id && open) });
  const form = useForm<Values>({ defaultValues: empty(initialOwner) });
  const f = detail.data;
  const errors = form.formState.errors;

  useEffect(() => {
    if (!open) return;
    form.reset(id && f ? fromDetail(f) : empty(initialOwner));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, id, f?.updatedAt, initialOwner?.id]);

  const submit = form.handleSubmit(async ({ owner, ...rest }) => {
    const parsed = farmInputSchema.safeParse({ ...rest, ownerPartnerId: owner?.id ?? '', dailyCapacity: rest.dailyCapacity ? parseDecimalInput(String(rest.dailyCapacity)) : '' });
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] === 'ownerPartnerId' ? 'owner' : (issue.path.join('.') as keyof Values);
        form.setError(key, { message: issue.message });
      }
      return;
    }
    try {
      const saved = id ? await put<FarmDetail>(`/farms/${id}`, parsed.data) : await post<FarmDetail>('/farms', parsed.data);
      toast.success(id ? 'Fazenda atualizada' : 'Fazenda cadastrada', { description: `${saved.name} · ${saved.owner.name}` });
      invalidate('farms');
      invalidate('farm');
      invalidate('partner');
      onClose();
    } catch (err) {
      handleSaveError(err, (name, e) => form.setError((name === 'ownerPartnerId' ? 'owner' : name) as keyof Values, e));
    }
  });

  const toggleArchive = async () => {
    if (!f) return;
    try {
      await post(`/farms/${f.id}/${f.status && (f as FarmDetail & { archived?: boolean }).archived ? 'restore' : 'archive'}`);
      toast.success('Fazenda arquivada');
      invalidate('farms');
      onClose();
    } catch (err) {
      handleSaveError(err, form.setError);
    }
  };

  return (
    <Drawer
      open={open}
      onRequestClose={onClose}
      title={id ? (f?.name ?? 'Carregando…') : 'Nova fazenda / propriedade'}
      subtitle={f ? `${f.owner.name}${f.city ? ` · ${f.city}/${f.state}` : ''}` : 'Apenas proprietário e nome são obrigatórios. Complete o restante quando tiver os dados.'}
      footer={
        <div className="flex items-center gap-2">
          {f && !readOnly ? (
            <Button variant="ghost" onClick={() => void toggleArchive()}>
              <Archive /> Arquivar
            </Button>
          ) : null}
          <div className="ml-auto flex gap-2">
            <Button variant="ghost" onClick={onClose}>
              {readOnly ? 'Fechar' : 'Cancelar'}
            </Button>
            {!readOnly ? (
              <Button onClick={() => void submit()} loading={form.formState.isSubmitting}>
                <Check /> Salvar
              </Button>
            ) : null}
          </div>
        </div>
      }
    >
      {id && !f ? (
        <div className="space-y-4 p-7">
          <Skeleton className="h-20" />
          <Skeleton className="h-64" />
        </div>
      ) : (
        <form onSubmit={submit} noValidate>
          <fieldset disabled={readOnly} className="contents">
            {f ? (
              <div className="grid grid-cols-3 gap-2 px-5 pt-5 sm:px-7">
                <Stat label="Ordens" value={f.ordersCount} />
                <Stat label="Volume em aberto" value={formatQty(f.openQuantity, 't')} />
                <Stat label="Capacidade/dia" value={f.dailyCapacity ? formatQty(f.dailyCapacity, 't') : '—'} />
              </div>
            ) : null}
            <FormSection title="Identificação">
              <Field label="Vendedor / proprietário" required className={span[6]} error={errors.owner?.message} hint={f && f.ordersCount ? 'Travado: a fazenda já possui ordens' : undefined}>
                {(a) => (
                  <Controller
                    control={form.control}
                    name="owner"
                    render={({ field }) => (
                      <AsyncCombobox {...a} value={field.value} onChange={field.onChange} disabled={Boolean(f?.ordersCount)} queryKey={['lookup', 'sellers', null]} fetchPage={lookups.sellers()} placeholder="Pesquisar vendedor, produtor ou cooperado…" />
                    )}
                  />
                )}
              </Field>
              <Field label="Nome da propriedade" required className={span[4]} error={errors.name?.message}>
                {(a) => <Input {...a} {...form.register('name')} />}
              </Field>
              <Field label="Código interno" className={span[2]}>
                {(a) => <Input {...a} {...form.register('code')} placeholder="FAZ-000" />}
              </Field>
              <Field label="Inscrição estadual" className={span[2]}>
                {(a) => <Input {...a} {...form.register('stateRegistration')} />}
              </Field>
              <Field label="Status" className={span[2]}>
                {(a) => <Select {...a} {...form.register('status')} options={[{ value: 'ACTIVE', label: 'Ativa' }, { value: 'INACTIVE', label: 'Inativa' }, { value: 'BLOCKED', label: 'Bloqueada' }]} />}
              </Field>
            </FormSection>

            <FormSection title="Localização">
              <Field label="Município" className={span[3]}>
                {(a) => <Input {...a} {...form.register('city')} />}
              </Field>
              <Field label="UF" className={span[1]}>
                {(a) => <Select {...a} {...form.register('state')} placeholder="—" options={UF.map((u) => ({ value: u, label: u }))} />}
              </Field>
              <Field label="CEP" className={span[2]} error={errors.zipCode?.message}>
                {(a) => <Input {...a} inputMode="numeric" {...form.register('zipCode')} />}
              </Field>
              <Field label="Endereço / acesso" className={span[6]}>
                {(a) => <Input {...a} {...form.register('address')} placeholder="Rodovia, km, estrada vicinal…" />}
              </Field>
              <Field label="Latitude" className={span[3]} error={errors.latitude?.message} hint="Decimal, ex.: -17.792300">
                {(a) => <Input {...a} inputMode="decimal" className="font-mono" {...form.register('latitude')} />}
              </Field>
              <Field label="Longitude" className={span[3]} error={errors.longitude?.message}>
                {(a) => <Input {...a} inputMode="decimal" className="font-mono" {...form.register('longitude')} />}
              </Field>
            </FormSection>

            <FormSection title="Operação de carregamento" description="Informações repassadas às transportadoras nos agendamentos.">
              <Field label="Ponto de carregamento" className={span[3]}>
                {(a) => <Input {...a} {...form.register('loadingPoint')} placeholder="Armazém, silo, balança…" />}
              </Field>
              <Field label="Capacidade estimada (t/dia)" className={span[3]} error={errors.dailyCapacity?.message}>
                {(a) => <Input {...a} inputMode="decimal" className="text-right tabular" {...form.register('dailyCapacity')} />}
              </Field>
              <Field label="Horário de operação" className={span[6]}>
                {(a) => <Input {...a} {...form.register('operatingHours')} placeholder="Seg–Sex 06:00–18:00 · Sáb 06:00–12:00" />}
              </Field>
              <Field label="Contato local" className={span[3]}>
                {(a) => <Input {...a} {...form.register('contactName')} />}
              </Field>
              <Field label="Telefone local" className={span[3]} error={errors.contactPhone?.message}>
                {(a) => <Input {...a} {...form.register('contactPhone')} />}
              </Field>
              <Field label="Restrições de acesso" className={span[6]}>
                {(a) => <Textarea {...a} rows={2} {...form.register('accessRestrictions')} placeholder="Altura máxima, tipo de veículo, período de chuva…" />}
              </Field>
              <Field label="Instruções para transportadora" className={span[6]}>
                {(a) => <Textarea {...a} rows={2} {...form.register('carrierInstructions')} />}
              </Field>
            </FormSection>

            <FormSection title="Observações">
              <Field label="Observações" className={span[6]}>
                {(a) => <Textarea {...a} rows={3} {...form.register('notes')} />}
              </Field>
            </FormSection>
          </fieldset>
        </form>
      )}
    </Drawer>
  );
}

export function FarmsPage() {
  const can = useCan();
  const params = useSearchParams();
  const router = useRouter();
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [owner, setOwner] = useState<ComboOption | null>(null);

  useEffect(() => {
    if (params.get('abrir')) setOpenId(params.get('abrir'));
    if (params.get('nova') === '1') {
      const ownerId = params.get('proprietario');
      if (ownerId) {
        void get<{ id: string; legalName: string; tradeName: string | null }>(`/partners/${ownerId}`).then((p) => setOwner({ id: p.id, label: p.tradeName ?? p.legalName }));
      }
      setCreating(true);
    }
  }, [params]);

  const close = () => {
    setOpenId(null);
    setCreating(false);
    setOwner(null);
    if (params.size) router.replace('/cadastros/fazendas', { scroll: false });
  };

  return (
    <>
      <RegistryList<FarmListItem>
        title="Fazendas"
        description="Propriedades rurais dos vendedores, produtores e cooperados."
        icon={<Sprout />}
        endpoint="/farms"
        queryKey="farms"
        searchPlaceholder="Buscar por fazenda, código, município ou proprietário…"
        createLabel="Nova fazenda"
        onCreate={can('farm.manage') ? () => setCreating(true) : undefined}
        onOpen={(r) => setOpenId(r.id)}
        columns={[
          {
            key: 'name',
            header: 'Propriedade',
            render: (f) => (
              <div className="min-w-0">
                <div className="truncate font-medium">{f.name}</div>
                <div className="truncate text-xs text-subtle">{f.code ?? 'Sem código'}</div>
              </div>
            ),
          },
          { key: 'owner', header: 'Proprietário', render: (f) => f.owner.name },
          {
            key: 'city',
            header: 'Localização',
            width: '220px',
            render: (f) => (
              <span className="inline-flex items-center gap-1.5">
                <Tooltip content={f.hasCoordinates ? 'Coordenadas cadastradas' : 'Sem coordenadas'}>
                  {f.hasCoordinates ? <MapPin className="size-3.5 text-primary" aria-label="Com coordenadas" /> : <MapPinOff className="size-3.5 text-subtle" aria-label="Sem coordenadas" />}
                </Tooltip>
                {f.city ? `${f.city}/${f.state}` : <span className="text-subtle">—</span>}
              </span>
            ),
          },
          { key: 'point', header: 'Ponto de carregamento', render: (f) => f.loadingPoint ?? <span className="text-subtle">—</span> },
          { key: 'orders', header: 'Ordens', width: '90px', align: 'right', render: (f) => <span className="tabular">{f.ordersCount}</span> },
          { key: 'open', header: 'Em aberto', width: '120px', align: 'right', render: (f) => <span className="tabular">{formatQty(f.openQuantity, 't')}</span> },
          { key: 'status', header: 'Status', width: '100px', render: (f) => <StatusPill status={f.status} /> },
        ]}
        renderCard={(f) => (
          <div className="space-y-1">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate font-medium">{f.name}</span>
              <StatusPill status={f.status} />
            </div>
            <div className="text-xs text-muted">{f.owner.name}</div>
            <div className="text-xs text-subtle">
              {f.city ? `${f.city}/${f.state} · ` : ''}
              {f.ordersCount} ordem(ns)
            </div>
          </div>
        )}
      />
      <FarmDrawer id={openId} open={Boolean(openId) || creating} initialOwner={owner} onClose={close} />
    </>
  );
}
