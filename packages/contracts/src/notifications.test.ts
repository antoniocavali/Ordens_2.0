import { describe, expect, it } from 'vitest';
import { isRealtimeDeliverable, type RealtimeMessage } from './schemas/notifications.js';

const T = 'tenant-a';
const matriz = { userId: 'u-m', tenantId: T, scope: 'MATRIZ', orgIds: ['org-matriz'] };
const farm = { userId: 'u-f', tenantId: T, scope: 'FARM', orgIds: ['org-farm'] };
const buyer = { userId: 'u-b', tenantId: T, scope: 'BUYER', orgIds: ['org-buyer'] };
const msg = (m: Partial<RealtimeMessage>): RealtimeMessage => ({ tenantId: T, kind: 'invalidate', keys: [['orders']], ...m });

describe('isRealtimeDeliverable', () => {
  it('nunca atravessa tenants', () => {
    expect(isRealtimeDeliverable(msg({ tenantId: 'tenant-b' }), matriz)).toBe(false);
  });

  it('Matriz recebe invalidações do tenant, inclusive internas', () => {
    expect(isRealtimeDeliverable(msg({ internalOnly: true }), matriz)).toBe(true);
    expect(isRealtimeDeliverable(msg({ orgIds: ['org-farm'] }), matriz)).toBe(true);
  });

  it('Fazenda e Comprador só recebem eventos das próprias organizações', () => {
    const shared = msg({ orgIds: ['org-farm'] });
    expect(isRealtimeDeliverable(shared, farm)).toBe(true);
    expect(isRealtimeDeliverable(shared, buyer)).toBe(false);
    expect(isRealtimeDeliverable(msg({}), farm)).toBe(false);
  });

  it('eventos internos não chegam às partes externas', () => {
    expect(isRealtimeDeliverable(msg({ internalOnly: true, orgIds: ['org-farm'] }), farm)).toBe(false);
  });

  it('mensagem pessoal vai apenas aos usuários indicados', () => {
    const personal = msg({ kind: 'notification', userIds: ['u-f'] });
    expect(isRealtimeDeliverable(personal, farm)).toBe(true);
    expect(isRealtimeDeliverable(personal, matriz)).toBe(false);
  });
});
