import { describe, expect, it } from 'vitest';
import {
  canTransitionLoad,
  canTransitionOrder,
  compareDecimalStrings,
  orderDraftSchema,
  permissionsForRoles,
  quantityString,
  ROLES,
  SUPPORT_FIRST_RESPONSE_SLA_MINUTES,
  supportSlaState,
} from './index.js';

describe('permissões', () => {
  it('somente papéis MATRIZ podem criar ordens', () => {
    for (const [code, role] of Object.entries(ROLES)) {
      const canCreate = (role.permissions as readonly string[]).includes('order.create');
      const readOnlyMatriz = ['MATRIZ_VIEWER', 'MATRIZ_SUPPORT_AGENT'].includes(code);
      expect(canCreate, code).toBe(role.scope === 'MATRIZ' && !readOnlyMatriz);
    }
  });

  it('comprador é somente leitura (pode abrir atendimento, não gerencia nada)', () => {
    const perms = [...permissionsForRoles(['BUYER_USER'])];
    // Abrir conversa de atendimento não altera dados operacionais.
    expect(perms.every((p) => p.endsWith('.read') || p.startsWith('dashboard.') || p === 'support.use')).toBe(true);
    expect(perms.some((p) => p.endsWith('.manage') || p.endsWith('.upload'))).toBe(false);
  });

  it('atendimento: supervisão para Gestor/Admin; atuar em filas para Operador e Atendente', () => {
    for (const role of ['MATRIZ_ADMIN', 'MATRIZ_MANAGER'] as const) expect(permissionsForRoles([role]).has('support.manage')).toBe(true);
    for (const role of ['MATRIZ_ADMIN', 'MATRIZ_MANAGER', 'MATRIZ_OPERATOR', 'MATRIZ_SUPPORT_AGENT'] as const) expect(permissionsForRoles([role]).has('support.attend')).toBe(true);
    for (const role of ['MATRIZ_OPERATOR', 'MATRIZ_SUPPORT_AGENT'] as const) expect(permissionsForRoles([role]).has('support.manage')).toBe(false);
    for (const role of ['MATRIZ_VIEWER', 'FARM_ADMIN', 'FARM_OPERATOR', 'BUYER_USER', 'CARRIER_USER'] as const) {
      expect(permissionsForRoles([role]).has('support.attend')).toBe(false);
      expect(permissionsForRoles([role]).has('support.use')).toBe(true);
    }
  });

  it('atendente não opera logística nem cadastros', () => {
    const perms = [...permissionsForRoles(['MATRIZ_SUPPORT_AGENT'])];
    expect(perms.some((p) => p.endsWith('.manage') || p.endsWith('.upload') || (p.startsWith('order.') && p !== 'order.read'))).toBe(false);
  });
});

describe('SLA do atendimento', () => {
  const queuedAt = new Date('2026-09-15T12:00:00Z');
  const at = (minutes: number) => queuedAt.getTime() + minutes * 60_000;

  it('conta 1 hora a partir da entrada na fila enquanto aguarda atendente', () => {
    expect(SUPPORT_FIRST_RESPONSE_SLA_MINUTES).toBe(60);
    expect(supportSlaState({ status: 'WAITING', queuedAt }, at(45))).toEqual({ dueAt: '2026-09-15T13:00:00.000Z', breached: false, minutesLeft: 15 });
    expect(supportSlaState({ status: 'WAITING', queuedAt }, at(90))).toMatchObject({ breached: true, minutesLeft: -30 });
  });

  it('não se aplica fora da fila', () => {
    for (const status of ['BOT', 'OPEN', 'PENDING_CUSTOMER', 'RESOLVED', 'CLOSED'] as const) {
      expect(supportSlaState({ status, queuedAt }, at(90))).toBeNull();
    }
    expect(supportSlaState({ status: 'WAITING', queuedAt: null }, at(90))).toBeNull();
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
