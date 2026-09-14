import { ROLES, type Permission, type RoleCode, type RoleDto } from '@ordens/contracts';

export const ORG_KIND_LABELS: Record<string, string> = { MATRIZ: 'Matriz', FARM: 'Fazenda', BUYER: 'Comprador', CARRIER: 'Transportadora' };

/** Resumo do que cada papel do sistema permite, para escolher com clareza no convite e na edição. */
export const ROLE_HINTS: Partial<Record<RoleCode, string>> = {
  MATRIZ_ADMIN: 'Tudo da Matriz, incluindo usuários, papéis e senhas',
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
export const isSystemRole = (id: string) => Object.hasOwn(ROLES, id);

export const roleHint = (r: RoleDto) => (r.system ? (ROLE_HINTS[r.id as RoleCode] ?? '') : (r.description ?? `${r.permissions.length} permissões`));

/** Separa a seleção única da tela em papéis do sistema e personalizados (API). */
export function splitRoleIds(ids: readonly string[]) {
  return { roles: ids.filter(isSystemRole), customRoleIds: ids.filter((id) => !isSystemRole(id)) };
}

/** Permissões resultantes dos papéis selecionados. */
export function permissionsOf(roles: readonly RoleDto[], ids: readonly string[]): Set<Permission> {
  return new Set(roles.filter((r) => ids.includes(r.id)).flatMap((r) => r.permissions));
}
