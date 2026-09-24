'use client';

import {
  CNH_CATEGORIES,
  onlyDigits,
  TRANSPORT_VEHICLE_TYPE_LABELS,
  TRANSPORT_VEHICLE_TYPES,
  type CnhCategory,
  type TransportVehicleType,
  type TransportDto,
  type TransportSuggestions,
} from '@ordens/contracts';
import { Button, Field, Input, Select } from '@ordens/ui';
import { Plus, Trash2 } from 'lucide-react';
import { useId } from 'react';
import { useFieldArray, useFormContext, type FieldErrors } from 'react-hook-form';
import { span } from '@/features/registry/form-utils';
import { useTransportSuggestions } from './logistics-api';

/** Uma linha da composição no formulário (tudo string: vem de <input>). */
export interface VehicleValues {
  plate: string;
  description: string;
  type: TransportVehicleType;
  axles: string;
  renavam: string;
}

export interface TransportValues {
  carrierName: string;
  driverName: string;
  driverCpf: string;
  driverRg: string;
  driverPhone: string;
  driverBirthDate: string;
  driverCnh: string;
  driverCnhCategory: string;
  driverCnhExpiresAt: string;
  driverCnhRestrictions: string;
  vehicles: VehicleValues[];
}

const emptyVehicle = (type: TransportVehicleType): VehicleValues => ({ plate: '', description: '', type, axles: '', renavam: '' });

export const emptyTransport = (): TransportValues => ({
  carrierName: '',
  driverName: '',
  driverCpf: '',
  driverRg: '',
  driverPhone: '',
  driverBirthDate: '',
  driverCnh: '',
  driverCnhCategory: '',
  driverCnhExpiresAt: '',
  driverCnhRestrictions: '',
  vehicles: [emptyVehicle('TRUCK_TRACTOR')],
});

/** Envia só as linhas com placa: uma linha em branco recém-adicionada não invalida o formulário. */
export function transportPayload(v: TransportValues) {
  return {
    carrierName: v.carrierName,
    driverName: v.driverName,
    driverCpf: v.driverCpf,
    driverRg: v.driverRg,
    driverPhone: v.driverPhone,
    driverBirthDate: v.driverBirthDate,
    driverCnh: v.driverCnh,
    // O select só oferece as categorias do contrato (ou vazio, que a API trata como não informado).
    driverCnhCategory: v.driverCnhCategory as CnhCategory | '',
    driverCnhExpiresAt: v.driverCnhExpiresAt,
    driverCnhRestrictions: v.driverCnhRestrictions,
    vehicles: v.vehicles.filter((x) => x.plate.trim()).map((x) => ({ ...x, axles: x.axles === '' ? null : x.axles })),
  };
}

export function transportFromDto(d: TransportDto): TransportValues {
  return {
    carrierName: d.carrierName ?? '',
    driverName: d.driverName ?? '',
    driverCpf: d.driverCpf ?? '',
    driverRg: d.driverRg ?? '',
    driverPhone: d.driverPhone ?? '',
    driverBirthDate: d.driverBirthDate ?? '',
    driverCnh: d.driverCnh ?? '',
    driverCnhCategory: d.driverCnhCategory ?? '',
    driverCnhExpiresAt: d.driverCnhExpiresAt ?? '',
    driverCnhRestrictions: d.driverCnhRestrictions ?? '',
    vehicles: d.vehicles.length
      ? d.vehicles.map((v) => ({ plate: v.plate, description: v.description ?? '', type: v.type, axles: v.axles?.toString() ?? '', renavam: v.renavam ?? '' }))
      : [emptyVehicle('TRUCK_TRACTOR')],
  };
}

const VEHICLE_TYPE_OPTIONS = TRANSPORT_VEHICLE_TYPES.map((t) => ({ value: t, label: TRANSPORT_VEHICLE_TYPE_LABELS[t] }));
const CNH_OPTIONS = CNH_CATEGORIES.map((c) => ({ value: c, label: c }));

/**
 * Transporte digitado, no formato do documento que o motorista apresenta. Não há cadastro: as listas
 * de sugestão trazem o que já foi digitado antes no grupo, e escolher uma sugestão preenche o resto
 * dos campos — ninguém redigita um motorista recorrente, e o relatório continua agrupando pelo nome.
 */
export function TransportFields({ disabled }: { disabled?: boolean }) {
  const { register, control, setValue, formState } = useFormContext<TransportValues>();
  const { fields, append, remove } = useFieldArray({ control, name: 'vehicles' });
  const errors = formState.errors as FieldErrors<TransportValues>;
  const suggestions = useTransportSuggestions();
  const listId = useId();

  const applyDriver = (value: string) => {
    const digits = onlyDigits(value);
    const match = suggestions.data?.drivers.find((d) => d.driverCpf === digits || d.driverName === value);
    if (!match) return;
    const set = (k: keyof TransportValues, v: string | null | undefined) => setValue(k, (v ?? '') as never, { shouldDirty: true });
    set('driverName', match.driverName);
    set('driverCpf', match.driverCpf);
    set('driverRg', match.driverRg);
    set('driverPhone', match.driverPhone);
    set('driverBirthDate', match.driverBirthDate);
    set('driverCnh', match.driverCnh);
    set('driverCnhCategory', match.driverCnhCategory);
    set('driverCnhExpiresAt', match.driverCnhExpiresAt);
    set('driverCnhRestrictions', match.driverCnhRestrictions);
    if (match.carrierName) set('carrierName', match.carrierName);
  };

  const applyVehicle = (index: number, plate: string) => {
    const normalized = plate.toUpperCase().replace(/[^A-Z0-9]/g, '');
    const match = suggestions.data?.vehicles.find((v) => v.plate === normalized);
    if (!match) return;
    setValue(`vehicles.${index}`, { plate: match.plate, description: match.description ?? '', type: match.type, axles: match.axles?.toString() ?? '', renavam: match.renavam ?? '' }, { shouldDirty: true });
  };

  return (
    <>
      <Field label="Transportadora" className={span[6]} error={errors.carrierName?.message}>
        {(a) => (
          <>
            <Input {...a} {...register('carrierName')} list={`${listId}-carriers`} disabled={disabled} placeholder="Nome da transportadora" autoComplete="off" />
            <datalist id={`${listId}-carriers`}>
              {(suggestions.data?.carriers ?? []).map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </>
        )}
      </Field>

      <p className="sm:col-span-6 text-[12.5px] font-semibold uppercase tracking-wide text-subtle">Dados do motorista</p>
      <Field label="Nome completo" className={span[4]} error={errors.driverName?.message}>
        {(a) => (
          <>
            <Input
              {...a}
              {...register('driverName', { onBlur: (e) => applyDriver((e.target as HTMLInputElement).value) })}
              list={`${listId}-drivers`}
              disabled={disabled}
              placeholder="Como está na CNH"
              autoComplete="off"
            />
            <datalist id={`${listId}-drivers`}>
              {(suggestions.data?.drivers ?? []).map((d) => (
                <option key={d.driverCpf ?? d.driverName} value={d.driverName ?? ''} label={formatCpf(d.driverCpf)} />
              ))}
            </datalist>
          </>
        )}
      </Field>
      <Field label="CPF" className={span[2]} error={errors.driverCpf?.message}>
        {(a) => <Input {...a} {...register('driverCpf', { onBlur: (e) => applyDriver((e.target as HTMLInputElement).value) })} disabled={disabled} inputMode="numeric" placeholder="000.000.000-00" />}
      </Field>
      <Field label="Data de nascimento" className={span[2]} error={errors.driverBirthDate?.message}>
        {(a) => <Input {...a} {...register('driverBirthDate')} type="date" disabled={disabled} />}
      </Field>
      <Field label="RG" className={span[2]} error={errors.driverRg?.message}>
        {(a) => <Input {...a} {...register('driverRg')} disabled={disabled} />}
      </Field>
      <Field label="Telefone" className={span[2]} error={errors.driverPhone?.message}>
        {(a) => <Input {...a} {...register('driverPhone')} disabled={disabled} inputMode="tel" placeholder="(00) 00000-0000" />}
      </Field>
      <Field label="CNH" className={span[2]} error={errors.driverCnh?.message}>
        {(a) => <Input {...a} {...register('driverCnh')} disabled={disabled} inputMode="numeric" placeholder="11 dígitos" />}
      </Field>
      <Field label="Categoria" className={span[2]} error={errors.driverCnhCategory?.message}>
        {(a) => <Select {...a} {...register('driverCnhCategory')} disabled={disabled} options={CNH_OPTIONS} placeholder="—" />}
      </Field>
      <Field label="Validade da CNH" className={span[2]} error={errors.driverCnhExpiresAt?.message} hint="Vencida na data do carregamento impede confirmar o agendamento.">
        {(a) => <Input {...a} {...register('driverCnhExpiresAt')} type="date" disabled={disabled} />}
      </Field>
      <Field label="Restrições" className={span[2]} error={errors.driverCnhRestrictions?.message}>
        {(a) => <Input {...a} {...register('driverCnhRestrictions')} disabled={disabled} placeholder="Ex.: EAR" />}
      </Field>

      <div className="sm:col-span-6 flex items-center justify-between gap-2">
        <p className="text-[12.5px] font-semibold uppercase tracking-wide text-subtle">Dados do veículo</p>
        {!disabled ? (
          <Button type="button" variant="ghost" size="sm" onClick={() => append(emptyVehicle(fields.length ? 'SEMI_TRAILER' : 'TRUCK_TRACTOR'))}>
            <Plus /> Adicionar veículo
          </Button>
        ) : null}
      </div>
      {typeof errors.vehicles?.message === 'string' ? <p className="sm:col-span-6 text-xs text-danger">{errors.vehicles.message}</p> : null}
      <div className="sm:col-span-6 flex flex-col gap-2">
        {fields.map((f, i) => (
          <div key={f.id} className="grid grid-cols-2 gap-2 rounded-md bg-surface-2/50 p-2 ring-1 ring-border sm:grid-cols-12">
            <Field label="Placa" className="sm:col-span-3" error={errors.vehicles?.[i]?.plate?.message}>
              {(a) => (
                <>
                  <Input
                    {...a}
                    {...register(`vehicles.${i}.plate`, { onBlur: (e) => applyVehicle(i, (e.target as HTMLInputElement).value) })}
                    list={`${listId}-plates`}
                    disabled={disabled}
                    placeholder="ABC1D23"
                    className="font-mono uppercase"
                    autoComplete="off"
                  />
                  <datalist id={`${listId}-plates`}>
                    {(suggestions.data?.vehicles ?? []).map((v) => (
                      <option key={v.plate} value={v.plate} label={v.description ?? TRANSPORT_VEHICLE_TYPE_LABELS[v.type]} />
                    ))}
                  </datalist>
                </>
              )}
            </Field>
            <Field label="Descrição" className="sm:col-span-4" error={errors.vehicles?.[i]?.description?.message}>
              {(a) => <Input {...a} {...register(`vehicles.${i}.description`)} disabled={disabled} placeholder="Marca/modelo" />}
            </Field>
            <Field label="Tipo" className="sm:col-span-2" error={errors.vehicles?.[i]?.type?.message}>
              {(a) => <Select {...a} {...register(`vehicles.${i}.type`)} disabled={disabled} options={VEHICLE_TYPE_OPTIONS} />}
            </Field>
            <Field label="Eixos" className="sm:col-span-1" error={errors.vehicles?.[i]?.axles?.message}>
              {(a) => <Input {...a} {...register(`vehicles.${i}.axles`)} disabled={disabled} inputMode="numeric" />}
            </Field>
            <Field label="RENAVAM" className="sm:col-span-2" error={errors.vehicles?.[i]?.renavam?.message}>
              {(a) => (
                <div className="flex items-center gap-1">
                  <Input {...a} {...register(`vehicles.${i}.renavam`)} disabled={disabled} inputMode="numeric" />
                  {!disabled && fields.length > 1 ? (
                    <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remover veículo ${i + 1}`} onClick={() => remove(i)}>
                      <Trash2 />
                    </Button>
                  ) : null}
                </div>
              )}
            </Field>
          </div>
        ))}
      </div>
    </>
  );
}

const formatCpf = (cpf: string | null) => (cpf && cpf.length === 11 ? `${cpf.slice(0, 3)}.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-${cpf.slice(9)}` : (cpf ?? ''));

export function Plates({ plates }: { plates: string[] }) {
  if (!plates.length) return <span className="text-subtle">Sem veículo</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {plates.map((p) => (
        <span key={p} className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[11.5px] font-semibold tracking-wide ring-1 ring-border">
          {p}
        </span>
      ))}
    </span>
  );
}

export type { TransportSuggestions };
