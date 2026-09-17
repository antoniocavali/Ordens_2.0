import { describe, expect, it } from 'vitest';
import { emailRecipients } from './notifications.js';

describe('e-mail dos avisos (Q44)', () => {
  const user = (id: string, emailNotifications?: unknown) => ({ id, email: `${id}@x.demo`, name: id, preferences: emailNotifications === undefined ? null : { emailNotifications } });

  it('segue o padrão do tipo, a escolha do usuário e o desligamento geral', () => {
    const users = [
      user('padrao'),
      user('desligou-tipo', { enabled: true, types: { 'order.returned': false } }),
      user('desligou-tudo', { enabled: false, types: {} }),
      user('ligou-versao', { enabled: true, types: { 'order.version_created': true } }),
    ];
    expect(emailRecipients(users, 'order.returned').map((u) => u.id)).toEqual(['padrao', 'ligou-versao']);
    expect(emailRecipients(users, 'order.version_created').map((u) => u.id)).toEqual(['ligou-versao']);
    // Atendimento e tipos fora do catálogo nunca geram e-mail.
    expect(emailRecipients(users, 'support.message_created')).toEqual([]);
  });
});
