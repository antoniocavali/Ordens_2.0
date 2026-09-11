import { describe, expect, it } from 'vitest';
import {
  canTransitionLoad,
  canTransitionOrder,
  compareDecimalStrings,
  orderDraftSchema,
  permissionsForRoles,
  quantityString,
  ROLES,
} from './index.js';

describe('permissões', () => {
  it('somente papéis MATRIZ podem criar ordens', () => {
    for (const [code, role] of Object.entries(ROLES)) {
      const canCreate = (role.permissions as readonly string[]).includes('order.create');
      expect(canCreate, code).toBe(role.scope === 'MATRIZ' && code !== 'MATRIZ_VIEWER');
    }
  });

  it('comprador é somente leitura (pode abrir atendimento, não gerencia nada)', () => {
    const perms = [...permissionsForRoles(['BUYER_USER'])];
    // Abrir conversa de atendimento não altera dados operacionais.
    expect(perms.every((p) => p.endsWith('.read') || p.startsWith('dashboard.') || p === 'support.use')).toBe(true);
    expect(perms.some((p) => p.endsWith('.manage') || p.endsWith('.upload'))).toBe(false);
  });

  it('só a Matriz operacional atende demandas; todos os perfis abrem conversas', () => {
    for (const role of ['MATRIZ_ADMIN', 'MATRIZ_MANAGER', 'MATRIZ_OPERATOR'] as const) expect(permissionsForRoles([role]).has('support.manage')).toBe(true);
    for (const role of ['MATRIZ_VIEWER', 'FARM_ADMIN', 'FARM_OPERATOR', 'BUYER_USER', 'CARRIER_USER'] as const) {
      expect(permissionsForRoles([role]).has('support.manage')).toBe(false);
      expect(permissionsForRoles([role]).has('support.use')).toBe(true);
    }
  });
});

describe('máquinas de estado', () => {
  it('ordem publicada não volta para rascunho', () => {
    expect(canTransitionOrder('PUBLISHED', 'DRAFT')).toBe(false);
    expect(canTransitionOrder('DRAFT', 'PUBLISHED')).toBe(true);
  });

  it('fazenda não recebe carga no destino nem cancela após carregamento', () => {
    expect(canTransitionLoad('ARRIVED', 'RECEIVED', 'FARM')).toBe(false);
    expect(canTransitionLoad('ARRIVED', 'RECEIVED', 'MATRIZ')).toBe(true);
    expect(canTransitionLoad('LOADING', 'CANCELLED', 'FARM')).toBe(false);
    expect(canTransitionLoad('CONFIRMED', 'CANCELLED', 'FARM')).toBe(true);
  });
});

describe('decimais', () => {
  it('rejeita notação float e aceita strings decimais', () => {
    expect(quantityString.safeParse('1000.5').success).toBe(true);
    expect(quantityString.safeParse('1e3').success).toBe(false);
    expect(quantityString.safeParse('1,5').success).toBe(false);
  });

  it('compara sem perda de precisão', () => {
    expect(compareDecimalStrings('0.3', '0.1')).toBe(1);
    expect(compareDecimalStrings('99999999999999.9999', '99999999999999.9998')).toBe(1);
    expect(compareDecimalStrings('10.50', '10.5')).toBe(0);
  });
});

describe('rascunho de ordem', () => {
  it('valida janela de carregamento', () => {
    const r = orderDraftSchema.safeParse({ loadingStartsOn: '2026-09-30', loadingEndsOn: '2026-09-15' });
    expect(r.success).toBe(false);
  });
});
