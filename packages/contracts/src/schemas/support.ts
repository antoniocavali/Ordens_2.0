import { z } from 'zod';

// ───────────────────────────── Enums e rótulos ─────────────────────────────

export const SUPPORT_QUEUES = ['BILLING', 'SUPPORT'] as const;
export type SupportQueue = (typeof SUPPORT_QUEUES)[number];
export const SUPPORT_QUEUE_LABELS: Record<SupportQueue, string> = { BILLING: 'Faturamento', SUPPORT: 'Suporte' };

/** Permissão que dá acesso a cada fila (time). `support.manage` (supervisão) acessa todas (Q31). */
export const SUPPORT_QUEUE_PERMISSION = { BILLING: 'support.billing', SUPPORT: 'support.support' } as const satisfies Record<SupportQueue, string>;

/** Filas que um conjunto de permissões pode atender. */
export function supportQueuesFor(permissions: Iterable<string>): SupportQueue[] {
  const set = new Set(permissions);
  if (set.has('support.manage')) return [...SUPPORT_QUEUES];
  return SUPPORT_QUEUES.filter((q) => set.has(SUPPORT_QUEUE_PERMISSION[q]));
}

/** Slug de rota do painel de cada time. */
export const SUPPORT_QUEUE_SLUGS: Record<SupportQueue, string> = { BILLING: 'faturamento', SUPPORT: 'suporte' };

export const SUPPORT_STATUSES = ['BOT', 'WAITING', 'OPEN', 'PENDING_CUSTOMER', 'RESOLVED', 'CLOSED'] as const;
export type SupportStatus = (typeof SUPPORT_STATUSES)[number];
export const SUPPORT_STATUS_LABELS: Record<SupportStatus, string> = {
  BOT: 'Com o assistente',
  WAITING: 'Aguardando atendente',
  OPEN: 'Em atendimento',
  PENDING_CUSTOMER: 'Aguardando cliente',
  RESOLVED: 'Resolvida',
  CLOSED: 'Encerrada',
};

export const SUPPORT_PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const;
export type SupportPriority = (typeof SUPPORT_PRIORITIES)[number];
export const SUPPORT_PRIORITY_LABELS: Record<SupportPriority, string> = { LOW: 'Baixa', NORMAL: 'Normal', HIGH: 'Alta', URGENT: 'Urgente' };

export type SupportAuthor = 'CUSTOMER' | 'AGENT' | 'BOT' | 'SYSTEM';

/** Transições feitas pelo atendente (painel de suporte). */
export const SUPPORT_AGENT_TRANSITIONS: Record<SupportStatus, readonly SupportStatus[]> = {
  BOT: ['WAITING', 'CLOSED'],
  WAITING: ['OPEN', 'RESOLVED', 'CLOSED'],
  OPEN: ['PENDING_CUSTOMER', 'RESOLVED', 'CLOSED'],
  PENDING_CUSTOMER: ['OPEN', 'RESOLVED', 'CLOSED'],
  RESOLVED: ['OPEN', 'CLOSED'],
  CLOSED: [],
};

/** Conversas ainda em andamento (painel e contadores). */
export const SUPPORT_ACTIVE_STATUSES: readonly SupportStatus[] = ['BOT', 'WAITING', 'OPEN', 'PENDING_CUSTOMER'];

// ───────────────────────────── Assistente (bot de triagem) ─────────────────────────────

export const SUPPORT_BOT_ACTIONS = ['BILLING', 'SUPPORT', 'AGENT'] as const;
export type SupportBotAction = (typeof SUPPORT_BOT_ACTIONS)[number];

export interface SupportBotOption {
  action: SupportBotAction;
  label: string;
  hint: string;
}

export const SUPPORT_BOT_OPTIONS: SupportBotOption[] = [
  { action: 'BILLING', label: 'Faturamento', hint: 'NF-e, cobrança, valores e pagamentos' },
  { action: 'SUPPORT', label: 'Suporte', hint: 'Acesso, erros e uso do sistema' },
];

const normalize = (text: string) =>
  text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

/** Palavras-chave de triagem (Q27). Comparação sem acento e em minúsculas. */
const BILLING_TERMS = ['fatur', 'nota fiscal', 'nf-e', 'nfe', 'danfe', 'xml', 'boleto', 'cobranc', 'pagamento', 'pagar', 'preco', 'valor', 'fiscal', 'imposto', 'icms', 'reembolso', 'desconto', 'credito', 'debito'];
const SUPPORT_TERMS = ['erro', 'acesso', 'senha', 'login', 'entrar', 'bug', 'trav', 'lento', 'nao consigo', 'sistema', 'tela', 'carregar', 'upload', '2fa', 'autentica', 'permiss', 'usuario', 'cadastr', 'nao aparece', 'sumiu'];
const AGENT_TERMS = ['atendente', 'humano', 'pessoa', 'falar com alguem', 'falar com um'];

const hits = (text: string, terms: readonly string[]) => terms.reduce((n, t) => n + (text.includes(t) ? 1 : 0), 0);

/** Classifica texto livre na fila provável; null quando não há sinal claro. */
export function classifySupportText(text: string): SupportQueue | null {
  const t = normalize(text);
  const billing = hits(t, BILLING_TERMS);
  const support = hits(t, SUPPORT_TERMS);
  if (billing > support) return 'BILLING';
  if (support > billing) return 'SUPPORT';
  return null;
}

export function asksForAgent(text: string): boolean {
  return hits(normalize(text), AGENT_TERMS) > 0;
}

/** Número de OC citado na mensagem (ex.: 2026/00033). */
export function findOrderNumber(text: string): string | null {
  return text.match(/\b(\d{4}\/\d{5})\b/)?.[1] ?? null;
}

// ───────────────────────────── Entradas ─────────────────────────────

const body = z.string().trim().max(4000);

export const supportStartSchema = z.object({
  message: body.optional(),
  orderId: z.uuid().optional(),
});
export type SupportStartInput = z.input<typeof supportStartSchema>;

export const supportMessageSchema = z
  .object({
    body: body.default(''),
    quickReply: z.enum(SUPPORT_BOT_ACTIONS).optional(),
    /** Nota interna: só atendentes enxergam. */
    internal: z.boolean().default(false),
  })
  .refine((v) => v.body.length > 0 || v.quickReply, { message: 'Escreva uma mensagem', path: ['body'] });
export type SupportMessageInput = z.input<typeof supportMessageSchema>;

const many = z
  .union([z.string(), z.array(z.string())])
  .transform((v) => (Array.isArray(v) ? v : [v]))
  .optional();

export const supportQueueQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(10).max(200).default(50),
  q: z.string().trim().max(120).optional(),
  queue: z.enum(SUPPORT_QUEUES).optional(),
  status: many,
  priority: z.enum(SUPPORT_PRIORITIES).optional(),
  assignee: z.union([z.literal('me'), z.literal('none'), z.uuid()]).optional(),
});
export type SupportQueueQuery = z.infer<typeof supportQueueQuery>;

export const supportSummaryQuery = z.object({ queue: z.enum(SUPPORT_QUEUES).optional() });
export type SupportSummaryQuery = z.infer<typeof supportSummaryQuery>;

export const supportAgentsQuery = z.object({
  q: z.string().trim().max(120).optional(),
  cursor: z.string().optional(),
  queue: z.enum(SUPPORT_QUEUES).optional(),
});
export type SupportAgentsQuery = z.infer<typeof supportAgentsQuery>;

export const SUPPORT_ANALYTICS_PERIODS = [7, 30, 90] as const;
export type SupportAnalyticsPeriod = (typeof SUPPORT_ANALYTICS_PERIODS)[number];

export const supportAnalyticsQuery = z.object({
  days: z.coerce
    .number()
    .int()
    .refine((v): v is SupportAnalyticsPeriod => (SUPPORT_ANALYTICS_PERIODS as readonly number[]).includes(v), 'Período inválido')
    .default(30),
  queue: z.enum(SUPPORT_QUEUES).optional(),
});
export type SupportAnalyticsQuery = z.infer<typeof supportAnalyticsQuery>;

export const supportAssignSchema = z.object({ assigneeUserId: z.uuid().nullable() });
export const supportTransitionSchema = z.object({ to: z.enum(SUPPORT_STATUSES) });
export const supportUpdateSchema = z
  .object({ queue: z.enum(SUPPORT_QUEUES).optional(), priority: z.enum(SUPPORT_PRIORITIES).optional() })
  .refine((v) => v.queue || v.priority, { message: 'Informe fila ou prioridade' });

// ───────────────────────────── Saídas ─────────────────────────────

export interface SupportMessageDto {
  id: string;
  authorType: SupportAuthor;
  author: { id: string; name: string } | null;
  body: string;
  internal: boolean;
  /** Botões de resposta rápida (somente na última mensagem do assistente). */
  options: SupportBotOption[] | null;
  createdAt: string;
}

export interface SupportConversationDto {
  id: string;
  number: string;
  queue: SupportQueue | null;
  status: SupportStatus;
  priority: SupportPriority;
  subject: string | null;
  requester: { id: string; name: string; organization: string | null };
  assignee: { id: string; name: string } | null;
  order: { id: string; number: string } | null;
  lastMessageAt: string;
  lastMessagePreview: string | null;
  firstResponseAt: string | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** Minutos desde que entrou (ou voltou, por transferência/reabertura) na fila; null fora da fila. */
  waitingMinutes: number | null;
  allowedTransitions: SupportStatus[];
}

export interface SupportConversationDetail extends SupportConversationDto {
  messages: SupportMessageDto[];
}

export interface SupportSummary {
  waiting: Record<SupportQueue, number>;
  open: number;
  pendingCustomer: number;
  unassigned: number;
  mine: number;
  resolvedToday: number;
  oldestWaitingMinutes: number | null;
  avgFirstResponseMinutes: number | null;
}

/** Faixas do tempo até a 1ª resposta (minutos, limite superior exclusivo). */
export const SUPPORT_RESPONSE_BUCKETS = [
  { key: 'lt15', label: 'Até 15 min', maxMinutes: 15 },
  { key: 'lt60', label: '15 min a 1 h', maxMinutes: 60 },
  { key: 'lt240', label: '1 a 4 h', maxMinutes: 240 },
  { key: 'lt1440', label: '4 a 24 h', maxMinutes: 1440 },
  { key: 'gte1440', label: 'Mais de 24 h', maxMinutes: null },
] as const;

/**
 * Indicadores de atendimento (Q32). Tempos contam a partir da abertura da conversa (inclui a triagem do assistente).
 * Conversas entram no período pela data de abertura; resolvidas, pela data de resolução.
 */
export interface SupportAnalytics {
  days: SupportAnalyticsPeriod;
  queues: SupportQueue[];
  generatedAt: string;
  totals: {
    opened: number;
    queued: number;
    resolved: number;
    /** Abertas no período que terminaram encerradas ainda com o assistente (sem fila). */
    abandonedInBot: number;
    backlog: number;
    unassigned: number;
    avgFirstResponseMinutes: number | null;
    p90FirstResponseMinutes: number | null;
    avgResolutionMinutes: number | null;
    /** % das conversas encaminhadas no período que já foram resolvidas ou encerradas. */
    resolutionRate: number | null;
  };
  previous: { opened: number; resolved: number; avgFirstResponseMinutes: number | null };
  daily: { day: string; opened: number; resolved: number }[];
  backlogByStatus: { status: SupportStatus; count: number }[];
  backlogByPriority: { priority: SupportPriority; count: number }[];
  firstResponseBuckets: { key: string; label: string; count: number }[];
  byHour: { hour: number; count: number }[];
  byQueue: { queue: SupportQueue; opened: number; resolved: number; backlog: number; avgFirstResponseMinutes: number | null; avgResolutionMinutes: number | null }[];
  byRequester: { kind: string; label: string; count: number }[];
  agents: { id: string; name: string; openNow: number; resolved: number; replies: number; avgFirstResponseMinutes: number | null }[];
}
