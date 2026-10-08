import { type LoadStatus, type OrderStatus, type Scope } from './enums.js';

type Transitions<S extends string> = Record<S, readonly S[]>;

/**
 * Ordem (Q41): o Comprador cria rascunho e envia ao Faturamento (PENDING_BILLING); a Matriz define
 * vendedor/fazenda e publica. Ordens criadas pela própria Matriz seguem DRAFT → PUBLISHED.
 */
export const ORDER_TRANSITIONS: Transitions<OrderStatus> = {
  DRAFT: ['PENDING_BILLING', 'PUBLISHED', 'CANCELLED'],
  // Faturamento publica ou devolve ao Comprador; Comprador cancela antes da análise.
  PENDING_BILLING: ['PUBLISHED', 'DRAFT', 'CANCELLED'],
  PUBLISHED: ['IN_PROGRESS', 'SUSPENDED', 'CANCELLED'],
  IN_PROGRESS: ['SUSPENDED', 'COMPLETED', 'CANCELLED'],
  SUSPENDED: ['PUBLISHED', 'IN_PROGRESS'],
  COMPLETED: [],
  CANCELLED: [],
};

export function canTransitionOrder(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_TRANSITIONS[from].includes(to);
}

/**
 * Carga: chegada do veículo (agendamento CHECKED_IN) → carga criada → carregamento → carregada (pesagem)
 * → aguardando documentação fiscal da Fazenda (PDF + XML) → documentação validada → trânsito → faturamento
 * da Matriz → concluída.
 *
 * Ordem das etapas (08/10/2026): documentação fiscal da Fazenda validada → faturamento da Matriz →
 * liberação para trânsito, que encerra a carga. O caminhão só sai depois que a Matriz fatura, e não há
 * etapa de recebimento no destino. ARRIVED, RECEIVED, CHECKED e AWAITING_MATRIZ_INVOICE continuam no
 * enum por causa do histórico de cargas antigas — nenhuma carga nova entra nesses estados.
 */
export const LOAD_TRANSITIONS: Transitions<LoadStatus> = {
  SCHEDULED: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['AWAITING_LOADING', 'CANCELLED'],
  AWAITING_LOADING: ['LOADING', 'CANCELLED'],
  LOADING: ['LOADED', 'CANCELLED'],
  LOADED: ['AWAITING_FARM_INVOICE'],
  AWAITING_FARM_INVOICE: ['FARM_INVOICED'],
  FARM_INVOICED: ['MATRIZ_INVOICED'],
  MATRIZ_INVOICED: ['IN_TRANSIT'],
  // Liberar para trânsito já conclui a carga (a API grava os dois passos de uma vez). Uma carga só
  // fica parada em IN_TRANSIT se veio do fluxo antigo; dali ela apenas conclui.
  IN_TRANSIT: ['COMPLETED'],
  // Saídas só para cargas antigas, que pararam em etapas que não existem mais.
  ARRIVED: ['COMPLETED'],
  RECEIVED: ['COMPLETED'],
  CHECKED: ['COMPLETED'],
  AWAITING_MATRIZ_INVOICE: ['MATRIZ_INVOICED'],
  COMPLETED: [],
  CANCELLED: [],
};

/** Escopos autorizados a mover uma carga PARA cada status. */
export const LOAD_TRANSITION_SCOPES: Record<LoadStatus, readonly Scope[]> = {
  SCHEDULED: ['MATRIZ', 'FARM'],
  CONFIRMED: ['MATRIZ', 'FARM'],
  AWAITING_LOADING: ['MATRIZ', 'FARM'],
  LOADING: ['MATRIZ', 'FARM'],
  LOADED: ['MATRIZ', 'FARM'],
  AWAITING_FARM_INVOICE: ['MATRIZ', 'FARM'],
  FARM_INVOICED: ['MATRIZ', 'FARM'],
  IN_TRANSIT: ['MATRIZ'],
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
  PENDING_BILLING: 'Aguardando faturamento',
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
  LOADED: 'Carregada',
  AWAITING_FARM_INVOICE: 'Aguardando documentação fiscal',
  FARM_INVOICED: 'Documentação fiscal validada',
  IN_TRANSIT: 'Em trânsito',
  // Etapas descontinuadas: só aparecem no histórico de cargas anteriores.
  ARRIVED: 'Chegada ao destino',
  RECEIVED: 'Recebida',
  CHECKED: 'Conferida',
  AWAITING_MATRIZ_INVOICE: 'Aguardando faturamento da Matriz',
  MATRIZ_INVOICED: 'Faturada pela Matriz',
  COMPLETED: 'Concluída',
  CANCELLED: 'Cancelada',
};
