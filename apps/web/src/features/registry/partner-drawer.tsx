'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { PARTNER_ROLE_LABELS, PARTNER_ROLES, partnerInputSchema, UF, type PartnerDetail, type PartnerRole } from '@ordens/contracts';
import { Button, cn, Drawer, Field, Input, Select, Skeleton, Textarea } from '@ordens/ui';
import { useQuery } from '@tanstack/react-query';
import { Archive, ArchiveRestore, Check, Plus, Sprout, Star, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useEffect } from 'react';
import { Controller, useFieldArray, useForm, useWatch } from 'react-hook-form';
import { toast } from 'sonner';
import type { z } from 'zod';
import { get, post, put } from '@/lib/api';
import { formatQty } from '@/lib/format';
import { useCan } from '@/lib/session';
import { StatusPill } from './registry-list';
import { FormSection, formatPhone, handleSaveError, span, Stat, useInvalidateRegistry } from './form-utils';

type Values = z.input<typeof partnerInputSchema>;

const empty = (roles: PartnerRole[]): Values => ({
  personType: 'PJ',
  legalName: '',
  tradeName: '',
  document: '',
  stateRegistration: '',
  email: '',
  phone: '',
  zipCode: '',
  address: '',
  city: '',
  state: '',
  notes: '',
  status: 'ACTIVE',
  roles,
  contacts: [],
  carrierProfile: { rntrc: '', rntrcExpiresAt: '', opsContactName: '', opsContactPhone: '', opsContactEmail: '' },
});

const fromDetail = (p: PartnerDetail): Values => ({
  personType: p.personType,
  legalName: p.legalName,
  tradeName: p.tradeName ?? '',
  document: p.document,
  stateRegistration: p.stateRegistration ?? '',
  email: p.email ?? '',
  phone: p.phone ?? '',
  zipCode: p.zipCode ?? '',
  address: p.address ?? '',
  city: p.city ?? '',
  state: (p.state ?? '') as Values['state'],
  notes: p.notes ?? '',
  status: p.status,
  roles: p.roles,
  contacts: p.contacts.map((c) => ({ name: c.name, role: c.role ?? '', phone: c.phone ?? '', email: c.email ?? '', isPrimary: c.isPrimary })),
  carrierProfile: {
    rntrc: p.carrierProfile?.rntrc ?? '',
    rntrcExpiresAt: p.carrierProfile?.rntrcExpiresAt ?? '',
    opsContactName: p.carrierProfile?.opsContactName ?? '',
    opsContactPhone: p.carrierProfile?.opsContactPhone ?? '',
    opsContactEmail: p.carrierProfile?.opsContactEmail ?? '',
  },
});

export function PartnerDrawer({ id, open, defaultRoles, onClose, entityLabel }: { id: string | null; open: boolean; defaultRoles: PartnerRole[]; onClose: () => void; entityLabel: string }) {
  const can = useCan();
  const readOnly = !can('partner.manage');
  const invalidate = useInvalidateRegistry();
  const detail = useQuery({ queryKey: ['registry', 'partner', id], queryFn: () => get<PartnerDetail>(`/partners/${id}`), enabled: Boolean(id && open) });
  const form = useForm<Values, unknown, z.output<typeof partnerInputSchema>>({ resolver: zodResolver(partnerInputSchema), defaultValues: empty(defaultRoles) });
  const contacts = useFieldArray({ control: form.control, name: 'contacts' });
  const [roles, personType] = useWatch({ control: form.control, name: ['roles', 'personType'] });
  const errors = form.formState.errors;
  const p = detail.data;

  useEffect(() => {
    if (!open) return;
    form.reset(id && p ? fromDetail(p) : empty(defaultRoles));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, id, p?.updatedAt]);

  const submit = form.handleSubmit(async (values) => {
    try {
      const saved = id ? await put<PartnerDetail>(`/partners/${id}`, values) : await post<PartnerDetail>('/partners', values);
      toast.success(id ? 'Parceiro atualizado' : `${entityLabel} cadastrado`, { description: saved.tradeName ?? saved.legalName });
      invalidate('partners');
      invalidate('partner');
      onClose();
    } catch (err) {
      handleSaveError(err, form.setError);
    }
  });

  const toggleArchive = async () => {
    if (!p) return;
    try {
      await post(`/partners/${p.id}/${p.archived ? 'restore' : 'archive'}`);
      toast.success(p.archived ? 'Parceiro restaurado' : 'Parceiro arquivado');
      invalidate('partners');
      invalidate('partner');
      onClose();
    } catch (err) {
      handleSaveError(err, form.setError);
    }
  };

  const toggleRole = (role: PartnerRole) => {
    const current = form.getValues('roles');
    form.setValue('roles', current.includes(role) ? current.filter((r) => r !== role) : [...current, role], { shouldDirty: true, shouldValidate: true });
  };

  return (
    <Drawer
      open={open}
      onRequestClose={onClose}
      title={id ? (p ? (p.tradeName ?? p.legalName) : 'Carregando…') : `Novo ${entityLabel.toLowerCase()}`}
      subtitle={
        p ? (
          <span className="flex flex-wrap items-center gap-2">
            <StatusPill status={p.status} archived={p.archived} />
            <span className="font-mono text-xs">{p.document}</span>
            {p.hasPortal ? <span className="text-xs text-success">· acesso ao portal</span> : null}
          </span>
        ) : id ? null : (
          'Um mesmo parceiro pode ser comprador, vendedor e transportadora — sem duplicar cadastro.'
        )
      }
      footer={
        <div className="flex items-center gap-2">
          {p && !readOnly ? (
            <Button variant="ghost" onClick={() => void toggleArchive()}>
              {p.archived ? <ArchiveRestore /> : <Archive />} {p.archived ? 'Restaurar' : 'Arquivar'}
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
      {id && !p ? (
        <div className="space-y-4 p-7">
          <Skeleton className="h-20" />
          <Skeleton className="h-64" />
        </div>
      ) : (
        <form onSubmit={submit} noValidate>
          <fieldset disabled={readOnly} className="contents">
            {p ? (
              <div className="grid grid-cols-2 gap-2 px-5 pt-5 sm:grid-cols-4 sm:px-7">
                <Stat label="Fazendas" value={p.farmsCount} />
                <Stat label="Ordens" value={p.ordersCount} />
                <Stat label="Volume em aberto" value={formatQty(p.openQuantity, 't')} />
                <Stat label="Contratos" value={p.contractsCount} />
              </div>
            ) : null}

            <FormSection title="Papéis" description="Define em quais operações o parceiro pode ser selecionado.">
              <div className="flex flex-wrap gap-2 sm:col-span-6" role="group" aria-label="Papéis do parceiro">
                {PARTNER_ROLES.map((role) => {
                  const on = roles.includes(role);
                  return (
                    <button
                      type="button"
                      key={role}
                      aria-pressed={on}
                      onClick={() => toggleRole(role)}
                      className={cn(
                        'inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium ring-1 ring-inset transition',
                        on ? 'bg-primary-soft text-primary ring-primary/30' : 'text-muted ring-border-strong hover:bg-surface-2',
                      )}
                    >
                      {on ? <Check className="size-3.5" /> : null}
                      {PARTNER_ROLE_LABELS[role]}
                    </button>
                  );
                })}
                {errors.roles ? <p className="w-full text-xs text-danger">{errors.roles.message}</p> : null}
              </div>
            </FormSection>

            <FormSection title="Identificação">
              <Field label="Tipo" className={span[2]}>
                {(a) => <Select {...a} {...form.register('personType')} options={[{ value: 'PJ', label: 'Pessoa jurídica' }, { value: 'PF', label: 'Pessoa física' }]} />}
              </Field>
              <Field label={personType === 'PF' ? 'CPF' : 'CNPJ'} required className={span[2]} error={errors.document?.message}>
                {(a) => <Input {...a} inputMode="numeric" className="font-mono" placeholder={personType === 'PF' ? '000.000.000-00' : '00.000.000/0000-00'} {...form.register('document')} />}
              </Field>
              <Field label="Inscrição estadual" className={span[2]}>
                {(a) => <Input {...a} {...form.register('stateRegistration')} />}
              </Field>
              <Field label={personType === 'PF' ? 'Nome completo' : 'Razão social'} required className={span[4]} error={errors.legalName?.message}>
                {(a) => <Input {...a} {...form.register('legalName')} />}
              </Field>
              <Field label="Status" className={span[2]}>
                {(a) => (
                  <Select {...a} {...form.register('status')} options={[{ value: 'ACTIVE', label: 'Ativo' }, { value: 'INACTIVE', label: 'Inativo' }, { value: 'BLOCKED', label: 'Bloqueado' }]} />
                )}
              </Field>
              <Field label="Nome fantasia" className={span[6]}>
                {(a) => <Input {...a} {...form.register('tradeName')} placeholder="Como aparece nas ordens e buscas" />}
              </Field>
            </FormSection>

            <FormSection title="Contato e endereço">
              <Field label="E-mail" className={span[3]} error={errors.email?.message}>
                {(a) => <Input {...a} type="email" {...form.register('email')} />}
              </Field>
              <Field label="Telefone" className={span[3]} error={errors.phone?.message}>
                {(a) => <Input {...a} inputMode="tel" {...form.register('phone')} placeholder="(00) 00000-0000" />}
              </Field>
              <Field label="CEP" className={span[2]} error={errors.zipCode?.message}>
                {(a) => <Input {...a} inputMode="numeric" {...form.register('zipCode')} />}
              </Field>
              <Field label="Município" className={span[3]}>
                {(a) => <Input {...a} {...form.register('city')} />}
              </Field>
              <Field label="UF" className={span[1]}>
                {(a) => <Select {...a} {...form.register('state')} placeholder="—" options={UF.map((u) => ({ value: u, label: u }))} />}
              </Field>
              <Field label="Endereço" className={span[6]}>
                {(a) => <Input {...a} {...form.register('address')} />}
              </Field>
            </FormSection>

            <FormSection title="Pessoas de contato">
              <div className="space-y-2 sm:col-span-6">
                {contacts.fields.map((f, i) => (
                  <div key={f.id} className="grid grid-cols-1 gap-2 rounded-lg bg-surface-2/60 p-3 sm:grid-cols-[1.4fr_1fr_1fr_1.3fr_auto]">
                    <Input aria-label="Nome" placeholder="Nome" {...form.register(`contacts.${i}.name`)} aria-invalid={Boolean(errors.contacts?.[i]?.name)} />
                    <Input aria-label="Função" placeholder="Função" {...form.register(`contacts.${i}.role`)} />
                    <Input aria-label="Telefone" placeholder="Telefone" {...form.register(`contacts.${i}.phone`)} aria-invalid={Boolean(errors.contacts?.[i]?.phone)} />
                    <Input aria-label="E-mail" placeholder="E-mail" {...form.register(`contacts.${i}.email`)} aria-invalid={Boolean(errors.contacts?.[i]?.email)} />
                    <div className="flex items-center gap-1">
                      <Controller
                        control={form.control}
                        name={`contacts.${i}.isPrimary`}
                        render={({ field }) => (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            aria-pressed={Boolean(field.value)}
                            aria-label="Contato principal"
                            title="Contato principal"
                            onClick={() => contacts.fields.forEach((_, j) => form.setValue(`contacts.${j}.isPrimary`, j === i, { shouldDirty: true }))}
                            className={field.value ? 'text-warning' : ''}
                          >
                            <Star className={field.value ? 'fill-current' : ''} />
                          </Button>
                        )}
                      />
                      <Button type="button" variant="ghost" size="icon-sm" aria-label="Remover contato" onClick={() => contacts.remove(i)}>
                        <Trash2 />
                      </Button>
                    </div>
                  </div>
                ))}
                <Button type="button" variant="outline" size="sm" onClick={() => contacts.append({ name: '', role: '', phone: '', email: '', isPrimary: contacts.fields.length === 0 })}>
                  <Plus /> Adicionar contato
                </Button>
              </div>
            </FormSection>

            {roles.includes('CARRIER') ? (
              <FormSection title="Transportadora" description="Dados regulatórios e contato operacional.">
                <Field label="RNTRC" className={span[2]} error={errors.carrierProfile?.rntrc?.message}>
                  {(a) => <Input {...a} inputMode="numeric" {...form.register('carrierProfile.rntrc')} />}
                </Field>
                <Field label="Validade do RNTRC" className={span[2]}>
                  {(a) => <Input {...a} type="date" {...form.register('carrierProfile.rntrcExpiresAt')} />}
                </Field>
                <div className="hidden sm:col-span-2 sm:block" />
                <Field label="Responsável operacional" className={span[2]}>
                  {(a) => <Input {...a} {...form.register('carrierProfile.opsContactName')} />}
                </Field>
                <Field label="Telefone operacional" className={span[2]} error={errors.carrierProfile?.opsContactPhone?.message}>
                  {(a) => <Input {...a} {...form.register('carrierProfile.opsContactPhone')} />}
                </Field>
                <Field label="E-mail operacional" className={span[2]} error={errors.carrierProfile?.opsContactEmail?.message}>
                  {(a) => <Input {...a} {...form.register('carrierProfile.opsContactEmail')} />}
                </Field>
                {p ? (
                  <div className="flex gap-2 text-sm sm:col-span-6">
                    <Link href={`/cadastros/motoristas?transportadora=${p.id}`} className="text-primary hover:underline">
                      {p.driversCount} motorista(s)
                    </Link>
                    <span className="text-subtle">·</span>
                    <Link href={`/cadastros/veiculos?transportadora=${p.id}`} className="text-primary hover:underline">
                      {p.vehiclesCount} veículo(s)
                    </Link>
                  </div>
                ) : null}
              </FormSection>
            ) : null}

            {p && (roles.includes('SELLER') || roles.includes('PRODUCER') || roles.includes('COOPERATIVE_MEMBER')) ? (
              <FormSection title="Propriedades rurais">
                <div className="space-y-2 sm:col-span-6">
                  {p.farms.length === 0 ? <p className="text-sm text-muted">Nenhuma fazenda cadastrada.</p> : null}
                  {p.farms.map((f) => (
                    <Link key={f.id} href={`/cadastros/fazendas?abrir=${f.id}`} className="flex items-center gap-3 rounded-lg px-3 py-2.5 ring-1 ring-border/70 transition hover:bg-surface-2">
                      <Sprout className="size-4 text-success" />
                      <span className="flex-1 font-medium">{f.name}</span>
                      <span className="text-xs text-muted">{f.city ? `${f.city}/${f.state}` : ''}</span>
                      <StatusPill status={f.status} />
                    </Link>
                  ))}
                  {can('farm.manage') ? (
                    <Button asChild variant="outline" size="sm">
                      <Link href={`/cadastros/fazendas?nova=1&proprietario=${p.id}`}>
                        <Plus /> Nova fazenda para este vendedor
                      </Link>
                    </Button>
                  ) : null}
                </div>
              </FormSection>
            ) : null}

            <FormSection title="Observações">
              <Field label="Observações internas" className={span[6]}>
                {(a) => <Textarea {...a} rows={3} {...form.register('notes')} />}
              </Field>
              {p?.contacts.length ? (
                <p className="text-xs text-subtle sm:col-span-6">Contato principal: {p.contacts.find((c) => c.isPrimary)?.name ?? p.contacts[0]!.name} · {formatPhone(p.contacts.find((c) => c.isPrimary)?.phone ?? p.contacts[0]!.phone)}</p>
              ) : null}
            </FormSection>
          </fieldset>
        </form>
      )}
    </Drawer>
  );
}
