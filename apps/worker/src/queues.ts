import type { JobsOptions } from 'bullmq';

export const QUEUE = {
  FILE_PROCESSING: 'file-processing',
  INVOICES: 'invoices',
  REALTIME: 'realtime',
  EMAIL: 'email',
  NOTIFICATIONS: 'notifications',
  MAINTENANCE: 'upload-maintenance',
  DEAD_LETTER: 'dead-letter',
} as const;

/** Retry exponencial padrão; jobs finais falhos vão para a fila dead-letter. */
export const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 6,
  backoff: { type: 'exponential', delay: 2_000 },
  removeOnComplete: { age: 24 * 3600, count: 5_000 },
  removeOnFail: { age: 7 * 24 * 3600 },
};

export interface OutboxJob {
  eventId: string;
  type: string;
  tenantId: string | null;
  aggregateId: string | null;
  correlationId: string | null;
  payload: Record<string, unknown>;
}

/** Roteamento de eventos de domínio para filas. */
export const ROUTES: Record<string, string[]> = {
  'upload.completed': [QUEUE.FILE_PROCESSING],
  'upload.available': [QUEUE.INVOICES, QUEUE.REALTIME],
  'upload.rejected': [QUEUE.REALTIME],
  'auth.password_reset_requested': [QUEUE.EMAIL],
  'user.invited': [QUEUE.EMAIL],
  'order.published': [QUEUE.NOTIFICATIONS, QUEUE.REALTIME],
  'order.version_created': [QUEUE.NOTIFICATIONS, QUEUE.REALTIME],
  'order.release_created': [QUEUE.NOTIFICATIONS, QUEUE.REALTIME],
  'order.viewed': [QUEUE.REALTIME],
  'appointment.created': [QUEUE.REALTIME],
  'appointment.status_changed': [QUEUE.REALTIME],
  'load.created': [QUEUE.REALTIME],
  'load.status_changed': [QUEUE.NOTIFICATIONS, QUEUE.REALTIME],
  'invoice.processed': [QUEUE.NOTIFICATIONS, QUEUE.REALTIME],
  'invoice.cancelled': [QUEUE.REALTIME],
  'occurrence.opened': [QUEUE.NOTIFICATIONS, QUEUE.REALTIME],
  'occurrence.status_changed': [QUEUE.REALTIME],
  'support.conversation_started': [QUEUE.REALTIME],
  'support.conversation_queued': [QUEUE.REALTIME],
  'support.message_created': [QUEUE.NOTIFICATIONS, QUEUE.REALTIME],
  'support.assigned': [QUEUE.NOTIFICATIONS, QUEUE.REALTIME],
  'support.status_changed': [QUEUE.NOTIFICATIONS, QUEUE.REALTIME],
  'support.updated': [QUEUE.REALTIME],
};
