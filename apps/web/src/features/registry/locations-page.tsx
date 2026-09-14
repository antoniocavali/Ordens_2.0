'use client';

import { LOCATION_KIND_LABELS, LOCATION_KINDS, locationInputSchema, UF, type LocationDetail, type LocationListItem } from '@ordens/contracts';
import { AsyncCombobox, Button, Drawer, Field, Input, Select, Skeleton, Textarea, Tooltip, type ComboOption } from '@ordens/ui';
import { useQuery } from '@tanstack/react-query';
import { Archive, ArchiveRestore, Check, MapPin, MapPinOff, Warehouse } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { toast } from 'sonner';
import type { z } from 'zod';
import { lookups } from '@/features/orders/orders-api';
import { get, post, put } from '@/lib/api';
import { useCan, useMe } from '@/lib/session';
import { FormSection, handleSaveError, span, Stat, useInvalidateRegistry } from './form-utils';
import { RegistryList, StatusPill } from './registry-list';

type Values = Omit<z.input<typeof locationInputSchema>, 'partnerId'> & { partner: ComboOption | null };

const empty = (): Values => ({
  partner: null,
  kind: 'WAREHOUSE',
  name: '',
  code: '',
  zipCode: '',
  address: '',
  city: '',
  state: '',
  latitude: '',
  longitude: '',
  operatingHours: '',
  receivingInstructions: '',
  contactName: '',
  contactPhone: '',
  notes: '',
  status: 'ACTIVE',
});

const fromDetail = (l: LocationDetail): Values => ({
  partner: l.partner ? { id: l.partner.id, label: l.partner.name } : null,
  kind: l.kind,
  name: l.name,
  code: l.code ?? '',
  zipCode: l.zipCode ?? '',
  address: l.address ?? '',
  city: l.city ?? '',
  state: (l.state ?? '') as Values['state'],
  latitude: l.latitude ?? '',
  longitude: l.longitude ?? '',
  operatingHours: l.operatingHours ?? '',
  receivingInstructions: l.receivingInstructions ?? '',
  contactName: l.contactName ?? '',
  contactPhone: l.contactPhone ?? '',
  notes: l.notes ?? '',
  status: l.status,
});

function LocationDrawer({ id, open, onClose }: { id: string | null; open: boolean; onClose: () => void }) {
  const can = useCan();
  const { data: me } = useMe();
  const readOnly = !can('partner.manage') || me?.activeMembership?.scope !== 'MATRIZ';
  const invalidate = useInvalidateRegistry();
  const detail = useQuery({ queryKey: ['registry', 'location', id], queryFn: () => get<LocationDetail>(`/locations/${id}`), enabled: Boolean(id && open) });
  const form = useForm<Values>({ defaultValues: empty() });
  const l = detail.data;
  const errors = form.formState.errors;

  useEffect(() => {
    if (!open) return;
    form.reset(id && l ? fromDetail(l) : empty());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, id, l?.updatedAt]);

  const submit = form.handleSubmit(async ({ partner, ...rest }) => {
    const parsed = locationInputSchema.safeParse({ ...rest, partnerId: partner?.id ?? '' });
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] === 'partnerId' ? 'partner' : (issue.path.join('.') as keyof Values);
        form.setError(key, { message: issue.message });
      }
      return;
    }
    try {
      const saved = id ? await put<LocationDetail>(`/locations/${id}`, parsed.data) : await post<LocationDetail>('/locations', parsed.data);
      toast.success(id ? 'Local atualizado' : 'Local cadastrado', { description: `${saved.name}${saved.city ? ` · ${saved.city}/${saved.state}` : ''}` });
      invalidate('locations');
      invalidate('location');
      onClose();
    } catch (err) {
      handleSaveError(err, (name, e) => form.setError((name === 'partnerId' ? 'partner' : name) as keyof Values, e));
    }
  });

  const toggleArchive = async () => {
    if (!l) return;
    try {
      await post(`/locations/${l.id}/${l.archived ? 'restore' : 'archive'}`);
      toast.success(l.archived ? 'Local restaurado' : 'Local arquivado');
      invalidate('locations');
      invalidate('location');
      onClose();
    } catch (err) {
      handleSaveError(err, form.setError);
    }
  };

  return (
    <Drawer
      open={open}
      onRequestClose={onClose}
      title={id ? (l?.name ?? 'Carregando…') : 'Novo local'}
      subtitle={l ? `${LOCATION_KIND_LABELS[l.kind]}${l.city ? ` · ${l.city}/${l.state}` : ''}` : 'Armazém, porto, indústria ou transbordo usado como destino das ordens.'}
      footer={
        <div className="flex items-center gap-2">
          {l && !readOnly ? (
            <Button variant="ghost" onClick={() => void toggleArchive()}>
              {l.archived ? <ArchiveRestore /> : <Archive />} {l.archived ? 'Restaurar' : 'Arquivar'}
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
      {id && !l ? (
        <div className="space-y-4 p-7">
          <Skeleton className="h-20" />
          <Skeleton className="h-64" />
        </div>
      ) : (
        <form onSubmit={submit} noValidate>
          <fieldset disabled={readOnly} className="contents">
            {l ? (
              <div className="grid grid-cols-2 gap-2 px-5 pt-5 sm:px-7">
                <Stat label="Ordens com este destino" value={l.ordersCount} />
                <Stat label="Comprador" value={l.partner?.name ?? 'Uso geral'} />
              </div>
            ) : null}
            <FormSection title="Identificação">
              <Field label="Nome do local" required className={span[4]} error={errors.name?.message}>
                {(a) => <Input {...a} {...form.register('name')} placeholder="Ex.: Armazém Rondonópolis" />}
              </Field>
              <Field label="Código" className={span[2]} error={errors.code?.message}>
                {(a) => <Input {...a} {...form.register('code')} placeholder="LOC-000" />}
              </Field>
              <Field label="Tipo" className={span[3]}>
                {(a) => <Select {...a} {...form.register('kind')} options={LOCATION_KINDS.map((k) => ({ value: k, label: LOCATION_KIND_LABELS[k] }))} />}
              </Field>
              <Field label="Status" className={span[3]}>
                {(a) => <Select {...a} {...form.register('status')} options={[{ value: 'ACTIVE', label: 'Ativo' }, { value: 'INACTIVE', label: 'Inativo' }, { value: 'BLOCKED', label: 'Bloqueado' }]} />}
              </Field>
              <Field label="Comprador vinculado" className={span[6]} error={errors.partner?.message} hint="Opcional. Vinculado, o local aparece primeiro nas ordens desse comprador e fica visível para ele.">
                {(a) => (
                  <Controller
                    control={form.control}
                    name="partner"
                    render={({ field }) => (
                      <AsyncCombobox {...a} value={field.value} onChange={field.onChange} queryKey={['lookup', 'buyers', null]} fetchPage={lookups.buyers()} placeholder="Uso geral (sem comprador)" />
                    )}
                  />
                )}
              </Field>
            </FormSection>

            <FormSection title="Endereço">
              <Field label="Município" className={span[3]} error={errors.city?.message}>
                {(a) => <Input {...a} {...form.register('city')} />}
              </Field>
              <Field label="UF" className={span[1]}>
                {(a) => <Select {...a} {...form.register('state')} placeholder="—" options={UF.map((u) => ({ value: u, label: u }))} />}
              </Field>
              <Field label="CEP" className={span[2]} error={errors.zipCode?.message}>
                {(a) => <Input {...a} inputMode="numeric" {...form.register('zipCode')} />}
              </Field>
              <Field label="Endereço de entrega" className={span[6]} error={errors.address?.message}>
                {(a) => <Input {...a} {...form.register('address')} placeholder="Rodovia, km, portaria…" />}
              </Field>
              <Field label="Latitude" className={span[3]} error={errors.latitude?.message} hint="Decimal, ex.: -16.470900">
                {(a) => <Input {...a} inputMode="decimal" className="font-mono" {...form.register('latitude')} />}
              </Field>
              <Field label="Longitude" className={span[3]} error={errors.longitude?.message}>
                {(a) => <Input {...a} inputMode="decimal" className="font-mono" {...form.register('longitude')} />}
              </Field>
            </FormSection>

            <FormSection title="Recebimento" description="Repassado às transportadoras junto com o destino da ordem.">
              <Field label="Horário de recebimento" className={span[6]}>
                {(a) => <Input {...a} {...form.register('operatingHours')} placeholder="Seg–Sex 07:00–17:00" />}
              </Field>
              <Field label="Contato no local" className={span[3]}>
                {(a) => <Input {...a} {...form.register('contactName')} />}
              </Field>
              <Field label="Telefone" className={span[3]} error={errors.contactPhone?.message}>
                {(a) => <Input {...a} {...form.register('contactPhone')} />}
              </Field>
              <Field label="Instruções de recebimento" className={span[6]}>
                {(a) => <Textarea {...a} rows={2} {...form.register('receivingInstructions')} placeholder="Agendamento na portaria, documentos exigidos, fila…" />}
              </Field>
              <Field label="Observações" className={span[6]}>
                {(a) => <Textarea {...a} rows={2} {...form.register('notes')} />}
              </Field>
            </FormSection>
          </fieldset>
        </form>
      )}
    </Drawer>
  );
}

export function LocationsPage() {
  const can = useCan();
  const { data: me } = useMe();
  const params = useSearchParams();
  const router = useRouter();
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const canManage = can('partner.manage') && me?.activeMembership?.scope === 'MATRIZ';

  useEffect(() => {
    if (params.get('abrir')) setOpenId(params.get('abrir'));
    if (params.get('novo') === '1') setCreating(true);
  }, [params]);

  const close = () => {
    setOpenId(null);
    setCreating(false);
    if (params.size) router.replace('/cadastros/locais', { scroll: false });
  };

  return (
    <>
      <RegistryList<LocationListItem>
        title="Locais"
        description="Armazéns, portos, indústrias e transbordos usados como destino das ordens."
        icon={<Warehouse />}
        endpoint="/locations"
        queryKey="locations"
        searchPlaceholder="Buscar por local, código, município ou comprador…"
        createLabel="Novo local"
        onCreate={canManage ? () => setCreating(true) : undefined}
        onOpen={(r) => setOpenId(r.id)}
        columns={[
          {
            key: 'name',
            header: 'Local',
            render: (l) => (
              <div className="min-w-0">
                <div className="truncate font-medium">{l.name}</div>
                <div className="truncate text-xs text-subtle">
                  {LOCATION_KIND_LABELS[l.kind]}
                  {l.code ? ` · ${l.code}` : ''}
                </div>
              </div>
            ),
          },
          { key: 'partner', header: 'Comprador', render: (l) => l.partner?.name ?? <span className="text-subtle">Uso geral</span> },
          {
            key: 'city',
            header: 'Localização',
            width: '220px',
            render: (l) => (
              <span className="inline-flex items-center gap-1.5">
                <Tooltip content={l.hasCoordinates ? 'Coordenadas cadastradas' : 'Sem coordenadas'}>
                  {l.hasCoordinates ? <MapPin className="size-3.5 text-primary" aria-label="Com coordenadas" /> : <MapPinOff className="size-3.5 text-subtle" aria-label="Sem coordenadas" />}
                </Tooltip>
                {l.city ? `${l.city}/${l.state}` : <span className="text-subtle">—</span>}
              </span>
            ),
          },
          { key: 'orders', header: 'Ordens', width: '90px', align: 'right', render: (l) => <span className="tabular">{l.ordersCount}</span> },
          { key: 'status', header: 'Status', width: '100px', render: (l) => <StatusPill status={l.status} /> },
        ]}
        renderCard={(l) => (
          <div className="space-y-1">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate font-medium">{l.name}</span>
              <StatusPill status={l.status} />
            </div>
            <div className="text-xs text-muted">
              {LOCATION_KIND_LABELS[l.kind]} · {l.partner?.name ?? 'Uso geral'}
            </div>
            <div className="text-xs text-subtle">{l.city ? `${l.city}/${l.state}` : 'Sem município'}</div>
          </div>
        )}
      />
      <LocationDrawer id={openId} open={Boolean(openId) || creating} onClose={close} />
    </>
  );
}
