import { z } from 'zod';

export interface NotificationDto {
  id: string;
  type: string;
  title: string;
  body: string | null;
  /** Rota da interface relacionada ao aviso (ordem, carga, ocorrência). */
  href: string | null;
  createdAt: string;
  readAt: string | null;
}

export interface NotificationsPage {
  items: NotificationDto[];
  unread: number;
}

export const notificationListQuery = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  unreadOnly: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
});
export type NotificationListQuery = z.infer<typeof notificationListQuery>;

/** Canal Redis entre worker e API para o stream SSE. */
export const REALTIME_CHANNEL = 'ordens:realtime';

/**
 * Mensagem de tempo real. Nunca carrega dados de negócio: apenas chaves de consulta a invalidar.
 * A interface busca de novo pela API, onde valem permissão e RLS.
 */
export interface RealtimeMessage {
  tenantId: string;
  kind: 'invalidate' | 'notification';
  keys: string[][];
  /** Entrega somente a estes usuários (ex.: notificação pessoal). */
  userIds?: string[];
  /** Organizações externas interessadas; a Matriz do tenant sempre recebe invalidações. */
  orgIds?: string[];
  /** Evento sem parte externa (ex.: ocorrência interna). */
  internalOnly?: boolean;
}

/** Regra de entrega de uma mensagem a uma conexão (usuário + membership ativa). */
export function isRealtimeDeliverable(
  msg: RealtimeMessage,
  target: { userId: string; tenantId: string; scope: string; orgIds: readonly string[] },
): boolean {
  if (msg.tenantId !== target.tenantId) return false;
  if (msg.userIds?.length) return msg.userIds.includes(target.userId);
  if (target.scope === 'MATRIZ') return true;
  if (msg.internalOnly) return false;
  return Boolean(msg.orgIds?.some((id) => target.orgIds.includes(id)));
}
