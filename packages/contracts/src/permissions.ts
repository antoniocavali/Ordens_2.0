import { Scope } from './enums.js';

/**
 * Catálogo de permissões — fonte de verdade. Sincronizado no banco pelo seed de referência.
 * Documentado em docs/permissions.md.
 */
export const PERMISSIONS = {
  'tenant.manage': 'Gerenciar tenants da plataforma',
  'security.policy.manage': 'Gerenciar política de segurança do tenant',
  'organization.read': 'Visualizar organizações',
  'organization.manage': 'Gerenciar organizações',
  'user.read': 'Visualizar usuários',
  'user.manage': 'Gerenciar usuários e papéis',
  'audit.read': 'Consultar auditoria',
  'partner.read': 'Visualizar parceiros',
  'partner.manage': 'Gerenciar parceiros',
  'farm.read': 'Visualizar fazendas',
  'farm.manage': 'Gerenciar fazendas',
  'commodity.read': 'Visualizar commodities',
  'commodity.manage': 'Gerenciar commodities',
  'contract.read': 'Visualizar contratos',
  'contract.manage': 'Gerenciar contratos',
  'carrier.read': 'Visualizar transportadoras, motoristas e veículos',
  'carrier.manage': 'Gerenciar transportadoras, motoristas e veículos',
  'order.read': 'Visualizar ordens de carregamento',
  'order.create': 'Criar ordens de carregamento',
  'order.update': 'Alterar ordens de carregamento',
  'order.publish': 'Publicar ordens de carregamento',
  'order.cancel': 'Cancelar ou suspender ordens',
  'order.release': 'Criar liberações de quantidade',
  'appointment.read': 'Visualizar agendamentos',
  'appointment.manage': 'Gerenciar agendamentos',
  'load.read': 'Visualizar cargas',
  'load.manage': 'Gerenciar cargas',
  'occurrence.read': 'Visualizar ocorrências',
  'occurrence.manage': 'Gerenciar ocorrências',
  'document.read': 'Visualizar documentos',
  'document.upload': 'Enviar documentos',
  'invoice.upload': 'Enviar NF-e',
  'dashboard.matriz': 'Dashboard da Matriz',
  'dashboard.farm': 'Dashboard da Fazenda',
  'dashboard.buyer': 'Dashboard do Comprador',
  'report.export': 'Exportar relatórios',
  'settings.manage': 'Gerenciar configurações do tenant',
  'support.use': 'Abrir conversas de atendimento',
  'support.manage': 'Atender e gerenciar demandas de suporte e faturamento',
} as const;

export type Permission = keyof typeof PERMISSIONS;
export const PERMISSION_CODES = Object.keys(PERMISSIONS) as Permission[];

const MATRIZ_READ: Permission[] = [
  'organization.read',
  'partner.read',
  'farm.read',
  'commodity.read',
  'contract.read',
  'carrier.read',
  'order.read',
  'appointment.read',
  'load.read',
  'occurrence.read',
  'document.read',
  'dashboard.matriz',
  'support.use',
];

const MATRIZ_OPERATE: Permission[] = [
  ...MATRIZ_READ,
  'partner.manage',
  'farm.manage',
  'carrier.manage',
  'order.create',
  'order.update',
  'appointment.manage',
  'load.manage',
  'occurrence.manage',
  'document.upload',
  'invoice.upload',
  'support.manage',
];

const MATRIZ_MANAGE: Permission[] = [
  ...MATRIZ_OPERATE,
  'user.read',
  'audit.read',
  'commodity.manage',
  'contract.manage',
  'order.publish',
  'order.cancel',
  'order.release',
  'report.export',
];

export interface RoleDefinition {
  name: string;
  scope: Scope;
  permissions: Permission[];
}

export const ROLES = {
  PLATFORM_SUPERADMIN: {
    name: 'Superadministrador SaaS',
    scope: Scope.PLATFORM,
    permissions: [
      'tenant.manage',
      'security.policy.manage',
      'organization.read',
      'organization.manage',
      'user.read',
      'user.manage',
      'audit.read',
    ],
  },
  MATRIZ_ADMIN: {
    name: 'Administrador Matriz',
    scope: Scope.MATRIZ,
    permissions: [
      ...MATRIZ_MANAGE,
      'user.manage',
      'organization.manage',
      'security.policy.manage',
      'settings.manage',
    ],
  },
  MATRIZ_MANAGER: { name: 'Gestor Matriz', scope: Scope.MATRIZ, permissions: MATRIZ_MANAGE },
  MATRIZ_OPERATOR: { name: 'Operador Matriz', scope: Scope.MATRIZ, permissions: MATRIZ_OPERATE },
  MATRIZ_VIEWER: { name: 'Somente leitura Matriz', scope: Scope.MATRIZ, permissions: MATRIZ_READ },
  FARM_ADMIN: {
    name: 'Administrador Fazenda',
    scope: Scope.FARM,
    permissions: [
      'organization.read',
      'user.read',
      'user.manage',
      'partner.read',
      'farm.read',
      'farm.manage',
      'commodity.read',
      'contract.read',
      'carrier.read',
      'order.read',
      'appointment.read',
      'appointment.manage',
      'load.read',
      'load.manage',
      'occurrence.read',
      'occurrence.manage',
      'document.read',
      'document.upload',
      'invoice.upload',
      'dashboard.farm',
      'support.use',
    ],
  },
  FARM_OPERATOR: {
    name: 'Operador Fazenda',
    scope: Scope.FARM,
    permissions: [
      'organization.read',
      'partner.read',
      'farm.read',
      'commodity.read',
      'carrier.read',
      'order.read',
      'appointment.read',
      'appointment.manage',
      'load.read',
      'load.manage',
      'occurrence.read',
      'occurrence.manage',
      'document.read',
      'document.upload',
      'invoice.upload',
      'dashboard.farm',
      'support.use',
    ],
  },
  BUYER_USER: {
    name: 'Comprador',
    scope: Scope.BUYER,
    permissions: [
      'organization.read',
      'partner.read',
      'commodity.read',
      'contract.read',
      'order.read',
      'appointment.read',
      'load.read',
      'occurrence.read',
      'document.read',
      'dashboard.buyer',
      'support.use',
    ],
  },
  CARRIER_USER: {
    name: 'Usuário Transportadora',
    scope: Scope.CARRIER,
    permissions: ['appointment.read', 'load.read', 'document.read', 'support.use'],
  },
} as const satisfies Record<string, RoleDefinition>;

export type RoleCode = keyof typeof ROLES;
export const ROLE_CODES = Object.keys(ROLES) as RoleCode[];

export function permissionsForRoles(roles: readonly string[]): Set<Permission> {
  const set = new Set<Permission>();
  for (const code of roles) {
    const def = (ROLES as Record<string, RoleDefinition>)[code];
    if (def) def.permissions.forEach((p) => set.add(p));
  }
  return set;
}
