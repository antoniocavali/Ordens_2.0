import { LoadStatus, OrderStatus, Scope } from './enums.js';

type Transitions<S extends string> = Record<S, readonly S[]>;

export const ORDER_TRANSITIONS: Transitions<OrderStatus> = {
  DRAFT: ['PUBLISHED', 'CANCELLED'],
  PUBLISHED: ['IN_PROGRESS', 'SUSPENDED', 'CANCELLED'],
  IN_PROGRESS: ['SUSPENDED', 'COMPLETED', 'CANCELLED'],
  SUSPENDED: ['PUBLISHED', 'IN_PROGRESS'],
  COMPLETED: [],
  CANCELLED: [],
};

export function canTransitionOrder(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_TRANSITIONS[from].includes(to);
}

export const LOAD_TRANSITIONS: Transitions<LoadStatus> = {
  SCHEDULED: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['AWAITING_LOADING', 'CANCELLED'],
  AWAITING_LOADING: ['LOADING', 'CANCELLED'],
  LOADING: ['AWAITING_FARM_INVOICE', 'CANCELLED'],
  AWAITING_FARM_INVOICE: ['FARM_INVOICED'],
  FARM_INVOICED: ['LOADED'],
  LOADED: ['IN_TRANSIT'],
  IN_TRANSIT: ['ARRIVED'],
  ARRIVED: ['RECEIVED'],
  RECEIVED: ['CHECKED'],
  CHECKED: ['AWAITING_MATRIZ_INVOICE'],
  AWAITING_MATRIZ_INVOICE: ['MATRIZ_INVOICED'],
  MATRIZ_INVOICED: ['COMPLETED'],
  COMPLETED: [],
  CANCELLED: [],
};

/** Escopos autorizados a mover uma carga PARA cada status. */
export const LOAD_TRANSITION_SCOPES: Record<LoadStatus, readonly Scope[]> = {
  SCHEDULED: ['MATRIZ', 'FARM'],
  CONFIRMED: ['MATRIZ', 'FARM'],
  AWAITING_LOADING: ['MATRIZ', 'FARM'],
  LOADING: ['MATRIZ', 'FARM'],
  AWAITING_FARM_INVOICE: ['MATRIZ', 'FARM'],
  FARM_INVOICED: ['MATRIZ', 'FARM'],
  LOADED: ['MATRIZ', 'FARM'],
  IN_TRANSIT: ['MATRIZ', 'FARM'],
  ARRIVED: ['MATRIZ'],
  RECEIVED: ['MATRIZ'],
  CHECKED: ['MATRIZ'],
  AWAITING_MATRIZ_INVOICE: ['MATRIZ'],
  MATRIZ_INVOICED: ['MATRIZ'],
  COMPLETED: ['MATRIZ'],
  CANCELLED: ['MATRIZ', 'FARM'],
};

export function canTransitionLoad(from: LoadStatus, to: LoadStatus, scope: Scope): boolean {
  if (!LOAD_TRANSITIONS[from].includes(to)) return false;
  if (!LOAD_TRANSITION_SCOPES[to].includes(scope)) return false;
  // Fazenda só cancela antes do carregamento começar.
  if (to === 'CANCELLED' && scope === 'FARM') {
    return ['SCHEDULED', 'CONFIRMED', 'AWAITING_LOADING'].includes(from);
  }
  return true;
}

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  DRAFT: 'Rascunho',
  PUBLISHED: 'Publicada',
  IN_PROGRESS: 'Em execução',
  SUSPENDED: 'Suspensa',
  COMPLETED: 'Concluída',
  CANCELLED: 'Cancelada',
};

export const LOAD_STATUS_LABELS: Record<LoadStatus, string> = {
  SCHEDULED: 'Agendada',
  CONFIRMED: 'Confirmada',
  AWAITING_LOADING: 'Aguardando carregamento',
  LOADING: 'Em carregamento',
  AWAITING_FARM_INVOICE: 'Aguardando faturamento',
  FARM_INVOICED: 'Faturada pela Fazenda',
  LOADED: 'Carregada',
  IN_TRANSIT: 'Em trânsito',
  ARRIVED: 'Chegada ao destino',
  RECEIVED: 'Recebida',
  CHECKED: 'Conferida',
  AWAITING_MATRIZ_INVOICE: 'Aguardando faturamento da Matriz',
  MATRIZ_INVOICED: 'Faturada pela Matriz',
  COMPLETED: 'Concluída',
  CANCELLED: 'Cancelada',
};
