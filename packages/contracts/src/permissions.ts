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
  'user.create': 'Criar usuários com senha provisória',
  'user.password.manage': 'Definir senha provisória de outros usuários',
  'role.manage': 'Criar e editar papéis personalizados',
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
  'order.submit': 'Criar, editar os próprios rascunhos e enviar solicitações de ordem ao Faturamento (Comprador)',
  'order.billing.manage': 'Tratar solicitações do Comprador: definir vendedor e fazenda e publicar (Faturamento)',
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
  'support.attend': 'Atuar como atendente (filas definidas na equipe do atendimento)',
  'support.manage': 'Supervisionar o atendimento (todas as filas, equipe e indicadores)',
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
  // Pode atender; as filas são definidas pela supervisão na equipe (Q31).
  'support.attend',
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
  'order.billing.manage',
  'report.export',
  'support.manage',
  // Gestor e Administrador criam usuários diretamente (Q36).
  'user.create',
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
      'user.password.manage',
      'role.manage',
      'organization.manage',
      'security.policy.manage',
      'settings.manage',
    ],
  },
  MATRIZ_MANAGER: { name: 'Gestor Matriz', scope: Scope.MATRIZ, permissions: MATRIZ_MANAGE },
  MATRIZ_OPERATOR: { name: 'Operador Matriz', scope: Scope.MATRIZ, permissions: MATRIZ_OPERATE },
  MATRIZ_VIEWER: { name: 'Somente leitura Matriz', scope: Scope.MATRIZ, permissions: MATRIZ_READ },
  MATRIZ_SUPPORT_AGENT: { name: 'Atendente', scope: Scope.MATRIZ, permissions: [...MATRIZ_READ, 'support.attend'] },
  /** Setor de Faturamento (Q41): trata solicitações do Comprador, define fazenda e publica; atende a fila de faturamento. */
  MATRIZ_BILLING: { name: 'Faturamento', scope: Scope.MATRIZ, permissions: [...MATRIZ_READ, 'order.update', 'order.billing.manage', 'support.attend'] },
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
      'order.submit',
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

/** Permissões efetivas: papéis do sistema + extras (papéis personalizados e concessões individuais). */
export function effectivePermissions(roles: readonly string[], extra: Iterable<string> = []): Set<Permission> {
  const set = permissionsForRoles(roles);
  for (const p of extra) if (Object.hasOwn(PERMISSIONS, p)) set.add(p as Permission);
  return set;
}

/** Permissões que podem ser concedidas individualmente, fora de papéis (Q34). */
export const GRANTABLE_PERMISSIONS = ['user.password.manage'] as const satisfies readonly Permission[];
export type GrantablePermission = (typeof GRANTABLE_PERMISSIONS)[number];

export const CUSTOM_ROLE_SCOPES = ['MATRIZ', 'FARM', 'BUYER', 'CARRIER'] as const;
export type CustomRoleScope = (typeof CUSTOM_ROLE_SCOPES)[number];

/**
 * Permissões permitidas em um papel personalizado do escopo: as que algum papel do sistema
 * do mesmo escopo já possui (Q35). Impede, por exemplo, papel de Fazenda com poderes da Matriz.
 */
export function permissionsAllowedForScope(scope: string): Permission[] {
  const allowed = new Set<Permission>();
  for (const def of Object.values(ROLES) as RoleDefinition[]) if (def.scope === scope) def.permissions.forEach((p) => allowed.add(p));
  return PERMISSION_CODES.filter((p) => allowed.has(p));
}

/** Agrupamento das permissões para escolha na tela de papéis. */
export const PERMISSION_GROUPS: { key: string; label: string; permissions: Permission[] }[] = [
  { key: 'orders', label: 'Ordens de carregamento', permissions: ['order.read', 'order.create', 'order.update', 'order.publish', 'order.cancel', 'order.release', 'order.submit', 'order.billing.manage'] },
  {
    key: 'logistics',
    label: 'Logística',
    permissions: ['appointment.read', 'appointment.manage', 'load.read', 'load.manage', 'occurrence.read', 'occurrence.manage'],
  },
  { key: 'documents', label: 'Documentos e NF-e', permissions: ['document.read', 'document.upload', 'invoice.upload'] },
  { key: 'commercial', label: 'Comercial', permissions: ['contract.read', 'contract.manage', 'commodity.read', 'commodity.manage'] },
  { key: 'registry', label: 'Cadastros', permissions: ['partner.read', 'partner.manage', 'farm.read', 'farm.manage', 'carrier.read', 'carrier.manage'] },
  { key: 'dashboards', label: 'Painéis e relatórios', permissions: ['dashboard.matriz', 'dashboard.farm', 'dashboard.buyer', 'report.export'] },
  { key: 'support', label: 'Atendimento', permissions: ['support.use', 'support.attend', 'support.manage'] },
  {
    key: 'admin',
    label: 'Administração',
    permissions: ['organization.read', 'organization.manage', 'user.read', 'user.create', 'user.manage', 'user.password.manage', 'role.manage', 'audit.read', 'security.policy.manage', 'settings.manage'],
  },
];
