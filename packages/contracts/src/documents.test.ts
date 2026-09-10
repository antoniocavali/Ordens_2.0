import { describe, expect, it } from 'vitest';
import { formatDocument, isValidCnpj, isValidCpf, isValidPlate, normalizePlate } from './documents.js';
import { driverInputSchema, partnerInputSchema, vehicleInputSchema } from './schemas/registry.js';

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

  it('motorista normaliza CPF e veículo normaliza placa', () => {
    const d = driverInputSchema.parse({ name: 'José Motorista', cpf: '529.982.247-25' });
    expect(d.cpf).toBe('52998224725');
    const v = vehicleInputSchema.parse({ plate: 'abc-1d23', type: 'TRUCK_TRACTOR' });
    expect(v.plate).toBe('ABC1D23');
  });
});
