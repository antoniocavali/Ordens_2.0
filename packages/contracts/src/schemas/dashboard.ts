import { z } from 'zod';
import type { Scope } from '../enums.js';

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
  /** Somente Matriz (Q24). */
  carriers: { id: string; name: string; loads: number; loadedT: string; divergentLoads: number }[];
}
