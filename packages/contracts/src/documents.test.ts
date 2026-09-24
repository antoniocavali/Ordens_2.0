import { describe, expect, it } from 'vitest';
import { formatDocument, isValidCnpj, isValidCpf, isValidPlate, normalizePlate } from './documents.js';
import { appointmentInputSchema } from './schemas/logistics.js';
import { partnerInputSchema } from './schemas/registry.js';

describe('documentos', () => {
  it('valida CPF por dígitos verificadores', () => {
    expect(isValidCpf('529.982.247-25')).toBe(true);
    expect(isValidCpf('529.982.247-26')).toBe(false);
    expect(isValidCpf('111.111.111-11')).toBe(false);
  });

  it('valida CNPJ por dígitos verificadores', () => {
    expect(isValidCnpj('11.222.333/0001-81')).toBe(true);
    expect(isValidCnpj('11.222.333/0001-80')).toBe(false);
    expect(isValidCnpj('00000000000000')).toBe(false);
  });

  it('formata documentos', () => {
    expect(formatDocument('52998224725')).toBe('529.982.247-25');
    expect(formatDocument('11222333000181')).toBe('11.222.333/0001-81');
  });

  it('aceita placas antiga e Mercosul', () => {
    expect(isValidPlate('abc-1234')).toBe(true);
    expect(isValidPlate('ABC1D23')).toBe(true);
    expect(isValidPlate('AB12345')).toBe(false);
    expect(normalizePlate('abc-1d23')).toBe('ABC1D23');
  });
});

describe('schemas de cadastro', () => {
  it('parceiro PJ exige CNPJ válido e ao menos um papel', () => {
    const bad = partnerInputSchema.safeParse({ personType: 'PJ', legalName: 'Teste', document: '52998224725', roles: [] });
    expect(bad.success).toBe(false);
    const good = partnerInputSchema.safeParse({ personType: 'PJ', legalName: 'Teste', document: '11.222.333/0001-81', roles: ['BUYER'], email: '' });
    expect(good.success).toBe(true);
    if (good.success) {
      expect(good.data.document).toBe('11222333000181');
      expect(good.data.email).toBeNull();
    }
  });

  it('transporte digitado normaliza CPF do motorista e placa do veículo', () => {
    const t = appointmentInputSchema.parse({
      orderId: '00000000-0000-4000-8000-000000000001',
      scheduledOn: '2026-10-01',
      expectedQty: '30',
      driverCpf: '529.982.247-25',
      vehicles: [{ plate: 'abc-1d23', type: 'TRUCK_TRACTOR' }],
    });
    expect(t.driverCpf).toBe('52998224725');
    expect(t.vehicles?.[0]?.plate).toBe('ABC1D23');
  });

  it('transporte digitado recusa CPF inválido e placa repetida na composição', () => {
    const base = { orderId: '00000000-0000-4000-8000-000000000001', scheduledOn: '2026-10-01', expectedQty: '30' };
    expect(appointmentInputSchema.safeParse({ ...base, driverCpf: '111.111.111-11' }).success).toBe(false);
    const repeated = appointmentInputSchema.safeParse({
      ...base,
      vehicles: [
        { plate: 'ABC1D23', type: 'TRUCK_TRACTOR' },
        { plate: 'abc1d23', type: 'SEMI_TRAILER' },
      ],
    });
    expect(repeated.success).toBe(false);
  });
});
