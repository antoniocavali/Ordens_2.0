import { describe, expect, it } from 'vitest';
import { publishApprovers, usersWithPermission } from './notifications.js';

describe('aviso de publicação solicitada', () => {
  it('avisa quem tem order.publish (papel, papel personalizado ou concessão), exceto quem pediu', () => {
    const ids = publishApprovers(
      [
        { userId: 'gestor', roles: ['MATRIZ_MANAGER'] },
        { userId: 'admin', roles: ['MATRIZ_ADMIN'] },
        { userId: 'operador', roles: ['MATRIZ_OPERATOR'] },
        { userId: 'custom', roles: ['MATRIZ_VIEWER'], extraPermissions: ['order.publish'] },
        { userId: 'gestor', roles: ['MATRIZ_MANAGER'] },
      ],
      'admin',
    );
    expect(ids.sort()).toEqual(['custom', 'gestor']);
  });

  it('solicitação do Comprador avisa quem tem order.billing.manage (Faturamento, Gestor e Administrador)', () => {
    const ids = usersWithPermission(
      [
        { userId: 'faturamento', roles: ['MATRIZ_BILLING'] },
        { userId: 'gestor', roles: ['MATRIZ_MANAGER'] },
        { userId: 'operador', roles: ['MATRIZ_OPERATOR'] },
        { userId: 'atendente', roles: ['MATRIZ_SUPPORT_AGENT'] },
      ],
      'order.billing.manage',
      null,
    );
    expect(ids.sort()).toEqual(['faturamento', 'gestor']);
  });

  it('sem aprovador disponível, ninguém é avisado', () => {
    expect(publishApprovers([{ userId: 'operador', roles: ['MATRIZ_OPERATOR'] }], 'operador')).toEqual([]);
  });
});
