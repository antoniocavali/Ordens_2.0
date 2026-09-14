import { ROLE_CODES, ROLES, type RoleCode } from '@ordens/contracts';

export const ORG_KIND_LABELS: Record<string, string> = { MATRIZ: 'Matriz', FARM: 'Fazenda', BUYER: 'Comprador', CARRIER: 'Transportadora' };

/** Resumo do que cada papel permite, para escolher com clareza no convite e na edição. */
const ROLE_HINTS: Partial<Record<RoleCode, string>> = {
  MATRIZ_ADMIN: 'Tudo da Matriz, incluindo usuários e segurança',
  MATRIZ_MANAGER: 'Opera, publica e libera ordens; supervisiona o atendimento',
  MATRIZ_OPERATOR: 'Opera ordens, cargas e cadastros; pode atender no chat',
  MATRIZ_SUPPORT_AGENT: 'Consulta e atende nas filas definidas na equipe do atendimento',
  MATRIZ_VIEWER: 'Consulta tudo, sem alterar',
  FARM_ADMIN: 'Gerencia a fazenda e os usuários dela',
  FARM_OPERATOR: 'Agendamentos, cargas e NF-e da fazenda',
  BUYER_USER: 'Acompanha ordens, cargas e documentos do comprador',
  CARRIER_USER: 'Agendamentos e cargas da transportadora',
};

export const roleName = (code: string) => (ROLES as Record<string, { name: string }>)[code]?.name ?? code;

/** Papéis que podem ser dados em uma organização do tipo informado (escopo do papel = tipo da organização). */
export function rolesForKind(kind: string) {
  return ROLE_CODES.filter((code) => (ROLES[code].scope as string) === kind).map((code) => ({ code, name: ROLES[code].name, hint: ROLE_HINTS[code] ?? '' }));
}

/** Papéis que dão permissão de atuar no atendimento (filas definidas na equipe). */
export const canAttendWith = (roles: readonly string[]) => roles.some((r) => r === 'MATRIZ_OPERATOR' || r === 'MATRIZ_SUPPORT_AGENT');
