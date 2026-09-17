import { z } from 'zod';
import type { OrderStatus, Scope } from '../enums.js';

export const DASHBOARD_PERIODS = ['today', '7d', '30d'] as const;
export type DashboardPeriod = (typeof DASHBOARD_PERIODS)[number];

export const DASHBOARD_PERIOD_LABELS: Record<DashboardPeriod, string> = { today: 'Hoje', '7d': '7 dias', '30d': '30 dias' };

export const dashboardQuery = z.object({
  period: z.enum(DASHBOARD_PERIODS).default('7d'),
  commodityId: z.uuid().optional(),
});
export type DashboardQuery = z.infer<typeof dashboardQuery>;

export type AttentionTone = 'danger' | 'warning' | 'info' | 'primary';

/** Item de "Precisa da sua atenção": contagem já recortada pelo RLS da organização ativa (Q22). */
export interface AttentionItem {
  key: string;
  label: string;
  count: number;
  tone: AttentionTone;
  href: string;
}

/** Volumes em toneladas (fator da unidade de cada ordem, Q23), sempre como string decimal. */
export interface DashboardDto {
  scope: Scope;
  period: DashboardPeriod;
  today: string;
  generatedAt: string;
  attention: AttentionItem[];
  kpis: {
    openOrders: number;
    publishedInPeriod: number;
    orderedT: string;
    contractedT: string | null;
    releasedT: string;
    scheduledT: string;
    loadedT: string;
    inTransitT: string;
    receivedT: string;
    balanceT: string;
    /** Somente Matriz e somente BRL (Q9/Q23). */
    loadedValue: string | null;
  };
  funnel: { key: string; label: string; valueT: string }[];
  daily: { day: string; loadedT: string; receivedT: string }[];
  loadsToday: { total: number; stages: { key: string; label: string; count: number }[] };
  byCommodity: { id: string; name: string; orderedT: string; loadedT: string }[];
  activeOrders: { id: string; number: string; commodity: string | null; counterpart: string | null; orderedT: string; loadedT: string }[];
  /** Somente Comprador: solicitações do portal (Q41) e cargas a caminho. */
  buyer: BuyerDashboard | null;
  /** Somente Matriz (Q24). */
  carriers: { id: string; name: string; loads: number; loadedT: string; divergentLoads: number }[];
}

export interface BuyerDashboard {
  /** Rascunhos e devoluções são só do próprio usuário (RLS); as demais contam a organização. */
  requests: { draft: number; returned: number; pendingBilling: number; publishedInPeriod: number; cancelledInPeriod: number };
  /** Horas médias entre o envio ao Faturamento e a publicação, para solicitações publicadas no período. */
  avgHoursToPublish: number | null;
  inbound: {
    id: string;
    number: string;
    orderId: string;
    orderNumber: string;
    commodity: string | null;
    farm: string | null;
    carrier: string | null;
    plates: string[];
    quantityT: string;
    status: 'IN_TRANSIT' | 'ARRIVED';
    since: string | null;
  }[];
}

/**
 * Painel de Gestão (Q46): tempos do ciclo da ordem, do envio/publicação até a conclusão.
 * Horas como número (uma casa); nulo quando não há amostra no período.
 */
export interface ManagementCycleDto {
  from: string;
  to: string;
  generatedAt: string;
  completed: number;
  autoCompleted: number;
  completedWithBalance: number;
  averagesHours: {
    submitToPublish: number | null;
    publishToFirstLoad: number | null;
    publishToComplete: number | null;
    firstLoadToComplete: number | null;
  };
  /** Percentil 90 de publicação → conclusão, em horas. */
  p90PublishToComplete: number | null;
  /** Distribuição do ciclo publicação → conclusão. */
  histogram: { key: string; label: string; count: number }[];
  byCommodity: { id: string; name: string; orders: number; avgHours: number | null }[];
  /** Ordens concluídas mais demoradas do período. */
  slowest: { id: string; number: string; commodity: string | null; counterpart: string | null; hours: number; via: string; completedAt: string }[];
  /** Ordens ainda abertas por tempo desde a publicação. */
  openAging: { key: string; label: string; count: number }[];
  /** Tempo de cada ordem (concluídas no período e abertas), da publicação ao fim ou até agora. */
  orders: ManagementOrderRow[];
  /** Houve mais ordens do que o limite da listagem. */
  ordersTruncated: boolean;
}

/** Uma linha por ordem: marcos e tempos em horas (nulo quando o marco não existe). */
export interface ManagementOrderRow {
  id: string;
  number: string;
  commodity: string | null;
  farm: string | null;
  buyer: string | null;
  status: OrderStatus;
  /** Conclusão automática, informada pela Matriz, ou null enquanto a ordem está aberta. */
  via: 'auto' | 'manual' | null;
  submittedAt: string | null;
  publishedAt: string | null;
  firstLoadAt: string | null;
  completedAt: string | null;
  loads: number;
  quantityT: string;
  loadedT: string;
  hours: {
    submitToPublish: number | null;
    publishToFirstLoad: number | null;
    /** Publicação → conclusão; para ordens abertas, publicação → agora. */
    publishToEnd: number | null;
  };
}

export const MANAGEMENT_ORDERS_LIMIT = 300;

export const MANAGEMENT_CYCLE_BUCKETS = [
  { key: 'd0_3', label: 'Até 3 dias', maxDays: 3 },
  { key: 'd4_7', label: '4 a 7 dias', maxDays: 7 },
  { key: 'd8_15', label: '8 a 15 dias', maxDays: 15 },
  { key: 'd16_30', label: '16 a 30 dias', maxDays: 30 },
  { key: 'd31', label: 'Mais de 30 dias', maxDays: null },
] as const;
