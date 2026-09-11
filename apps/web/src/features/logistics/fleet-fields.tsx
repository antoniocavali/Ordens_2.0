'use client';

import { AsyncCombobox, Field, type ComboOption } from '@ordens/ui';
import { Controller, useWatch, type Control, type FieldValues, type Path, type UseFormSetValue } from 'react-hook-form';
import { lookups } from '@/features/orders/orders-api';
import { span } from '@/features/registry/form-utils';
import { fleetLookups } from './logistics-api';

export interface FleetValues {
  carrier: ComboOption | null;
  driver: ComboOption | null;
  tractor: ComboOption | null;
  trailer: ComboOption | null;
  secondTrailer: ComboOption | null;
}

export const emptyFleet = (): FleetValues => ({ carrier: null, driver: null, tractor: null, trailer: null, secondTrailer: null });

export function fleetPayload(v: FleetValues) {
  return {
    carrierPartnerId: v.carrier?.id ?? null,
    driverId: v.driver?.id ?? null,
    tractorVehicleId: v.tractor?.id ?? null,
    trailerVehicleId: v.trailer?.id ?? null,
    secondTrailerVehicleId: v.secondTrailer?.id ?? null,
  };
}

export const FLEET_API_TO_FORM: Record<string, string> = {
  carrierPartnerId: 'carrier',
  driverId: 'driver',
  tractorVehicleId: 'tractor',
  trailerVehicleId: 'trailer',
  secondTrailerVehicleId: 'secondTrailer',
};

/** Transportadora → motorista/veículos filtrados pela transportadora; troca de transportadora limpa a frota incompatível. */
export function FleetFields<T extends FieldValues & FleetValues>({
  control,
  setValue,
  errors,
  disabled,
}: {
  control: Control<T>;
  setValue: UseFormSetValue<T>;
  errors: Partial<Record<keyof FleetValues, { message?: string }>>;
  disabled?: boolean;
}) {
  const carrier = useWatch({ control, name: 'carrier' as Path<T> }) as ComboOption | null;
  const carrierId = carrier?.id ?? null;

  const field = (name: keyof FleetValues, label: string, fetchPage: Parameters<typeof AsyncCombobox>[0]['fetchPage'], key: unknown[], className: string, placeholder: string) => (
    <Field label={label} className={className} error={errors[name]?.message}>
      {(a) => (
        <Controller
          control={control}
          name={name as Path<T>}
          render={({ field: f }) => (
            <AsyncCombobox {...a} value={f.value as ComboOption | null} onChange={f.onChange} disabled={disabled} queryKey={key} fetchPage={fetchPage} placeholder={placeholder} />
          )}
        />
      )}
    </Field>
  );

  return (
    <>
      <Field label="Transportadora" className={span[6]} error={errors.carrier?.message}>
        {(a) => (
          <Controller
            control={control}
            name={'carrier' as Path<T>}
            render={({ field: f }) => (
              <AsyncCombobox
                {...a}
                value={f.value as ComboOption | null}
                disabled={disabled}
                onChange={(next) => {
                  f.onChange(next);
                  // Frota vinculada a outra transportadora deixa de ser válida.
                  for (const k of ['driver', 'tractor', 'trailer', 'secondTrailer'] as const) setValue(k as Path<T>, null as never, { shouldDirty: true });
                }}
                queryKey={['lookup', 'carriers']}
                fetchPage={lookups.carriers()}
                placeholder="Transportadora a definir"
              />
            )}
          />
        )}
      </Field>
      {field('driver', 'Motorista', fleetLookups.drivers(carrierId), ['lookup', 'drivers', carrierId], span[6], 'Pesquisar motorista…')}
      {field('tractor', 'Cavalo / caminhão', fleetLookups.vehicles('tractor', carrierId), ['lookup', 'tractors', carrierId], span[2], 'Placa')}
      {field('trailer', 'Carreta 1', fleetLookups.vehicles('trailer', carrierId), ['lookup', 'trailers', carrierId], span[2], 'Placa')}
      {field('secondTrailer', 'Carreta 2', fleetLookups.vehicles('trailer', carrierId), ['lookup', 'trailers', carrierId], span[2], 'Placa')}
    </>
  );
}

export function fleetFromDto(d: {
  carrier: { id: string; name: string } | null;
  driver: { id: string; name: string } | null;
  tractor: { id: string; plate: string } | null;
  trailer: { id: string; plate: string } | null;
  secondTrailer: { id: string; plate: string } | null;
}): FleetValues {
  return {
    carrier: d.carrier ? { id: d.carrier.id, label: d.carrier.name } : null,
    driver: d.driver ? { id: d.driver.id, label: d.driver.name } : null,
    tractor: d.tractor ? { id: d.tractor.id, label: d.tractor.plate } : null,
    trailer: d.trailer ? { id: d.trailer.id, label: d.trailer.plate } : null,
    secondTrailer: d.secondTrailer ? { id: d.secondTrailer.id, label: d.secondTrailer.plate } : null,
  };
}

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
