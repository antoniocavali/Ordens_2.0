import { describe, expect, it } from 'vitest';
import { slaRecipients } from './support-sla.js';

describe('avisos de SLA do atendimento', () => {
  const members = [
    { userId: 'gestor', roles: ['MATRIZ_MANAGER'], queues: [] },
    { userId: 'operador-fat', roles: ['MATRIZ_OPERATOR'], queues: ['BILLING'] },
    { userId: 'atendente-sup', roles: ['MATRIZ_SUPPORT_AGENT'], queues: ['SUPPORT'] },
    { userId: 'atendente-sem-fila', roles: ['MATRIZ_SUPPORT_AGENT'], queues: [] },
    // Linha de fila sem permissão de atendente (papel alterado depois) não recebe aviso.
    { userId: 'leitura', roles: ['MATRIZ_VIEWER'], queues: ['BILLING'] },
  ];

  it('avisa supervisão e quem atende a fila da conversa', () => {
    expect(slaRecipients(members, 'BILLING').sort()).toEqual(['gestor', 'operador-fat']);
    expect(slaRecipients(members, 'SUPPORT').sort()).toEqual(['atendente-sup', 'gestor']);
  });

  it('não duplica destinatários', () => {
    expect(slaRecipients([...members, members[0]!], 'SUPPORT')).toHaveLength(2);
  });
});
