import type { Permission, Scope, SupportQueue } from '@ordens/contracts';
import {
  AlertTriangle,
  BarChart3,
  Boxes,
  Building2,
  CalendarClock,
  ClipboardList,
  FileSpreadsheet,
  FileText,
  Gauge,
  Headphones,
  History,
  KeyRound,
  LifeBuoy,
  LineChart,
  MapPin,
  Package,
  PackageCheck,
  Receipt,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sprout,
  Timer,
  Truck,
  UserRound,
  Users,
  UsersRound,
  Wheat,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  permission?: Permission;
  /** Basta uma destas permissões. */
  anyPermission?: Permission[];
  /** Visível para quem atende esta fila do atendimento. */
  supportQueue?: SupportQueue;
  /** Visível para quem atende alguma fila do atendimento. */
  supportAny?: boolean;
  scopes?: Scope[];
  /** Módulo de fase futura: aparece desabilitado com tooltip. */
  soon?: boolean;
}

export interface NavGroup {
  label?: string;
  items: NavItem[];
}

export const NAVIGATION: NavGroup[] = [
  { items: [{ label: 'Visão geral', href: '/', icon: Gauge }] },
  {
    label: 'Operação',
    items: [
      { label: 'Ordens de Carregamento', href: '/ordens', icon: ClipboardList, permission: 'order.read' },
      { label: 'Liberações', href: '/liberacoes', icon: PackageCheck, permission: 'order.read' },
      { label: 'Agendamentos', href: '/agendamentos', icon: CalendarClock, permission: 'appointment.read' },
      { label: 'Cargas', href: '/cargas', icon: Truck, permission: 'load.read' },
      { label: 'Ocorrências', href: '/ocorrencias', icon: AlertTriangle, permission: 'occurrence.read' },
    ],
  },
  {
    label: 'Documentos',
    items: [
      { label: 'Central de Documentos', href: '/documentos', icon: FileText, permission: 'document.read' },
      { label: 'Notas Fiscais', href: '/documentos/nfe', icon: FileSpreadsheet, permission: 'document.read' },
    ],
  },
  {
    label: 'Comercial',
    items: [
      { label: 'Contratos', href: '/contratos', icon: FileText, permission: 'contract.read', scopes: ['MATRIZ'] },
      { label: 'Commodities', href: '/commodities', icon: Wheat, permission: 'commodity.read', scopes: ['MATRIZ'] },
    ],
  },
  {
    label: 'Cadastros',
    items: [
      { label: 'Compradores', href: '/cadastros/compradores', icon: Building2, permission: 'partner.read', scopes: ['MATRIZ'] },
      { label: 'Vendedores', href: '/cadastros/vendedores', icon: UserRound, permission: 'partner.read', scopes: ['MATRIZ'] },
      { label: 'Fazendas', href: '/cadastros/fazendas', icon: Sprout, permission: 'farm.read' },
      { label: 'Transportadoras', href: '/cadastros/transportadoras', icon: Boxes, permission: 'carrier.read' },
      { label: 'Motoristas', href: '/cadastros/motoristas', icon: Users, permission: 'carrier.read' },
      { label: 'Veículos', href: '/cadastros/veiculos', icon: Package, permission: 'carrier.read' },
      { label: 'Locais', href: '/cadastros/locais', icon: MapPin, permission: 'partner.read', scopes: ['MATRIZ'] },
    ],
  },
  {
    label: 'Atendimento',
    items: [
      { label: 'Visão geral', href: '/atendimento', icon: Headphones, permission: 'support.manage' },
      { label: 'Faturamento', href: '/atendimento/faturamento', icon: Receipt, supportQueue: 'BILLING' },
      { label: 'Suporte', href: '/atendimento/suporte', icon: LifeBuoy, supportQueue: 'SUPPORT' },
      { label: 'Indicadores', href: '/atendimento/indicadores', icon: LineChart, supportAny: true },
      { label: 'Equipe', href: '/atendimento/equipe', icon: UsersRound, permission: 'support.manage' },
    ],
  },
  {
    label: 'Gestão',
    items: [
      { label: 'Gestão do ciclo', href: '/gestao/ciclo', icon: Timer, permission: 'dashboard.matriz' },
      { label: 'Relatórios', href: '/gestao/relatorios', icon: BarChart3, permission: 'report.export' },
      { label: 'Auditoria', href: '/gestao/auditoria', icon: History, permission: 'audit.read' },
      { label: 'Usuários', href: '/gestao/usuarios', icon: Users, permission: 'user.read' },
      { label: 'Papéis e permissões', href: '/gestao/papeis', icon: KeyRound, permission: 'role.manage' },
    ],
  },
  {
    label: 'Configurações',
    items: [
      { label: 'Segurança', href: '/configuracoes/seguranca', icon: ShieldCheck, permission: 'security.policy.manage' },
      { label: 'Preferências', href: '/conta/seguranca', icon: SlidersHorizontal },
      { label: 'Workflow', href: '/configuracoes/workflow', icon: Settings2, permission: 'settings.manage' },
    ],
  },
];

export function visibleNavigation(can: (p: Permission) => boolean, scope: Scope | undefined, supportQueues: readonly SupportQueue[] = []): NavGroup[] {
  return NAVIGATION.map((g) => ({
    ...g,
    items: g.items.filter(
      (i) =>
        (!i.permission || can(i.permission)) &&
        (!i.anyPermission || i.anyPermission.some(can)) &&
        (!i.supportQueue || supportQueues.includes(i.supportQueue)) &&
        (!i.supportAny || supportQueues.length > 0) &&
        (!i.scopes || (scope && i.scopes.includes(scope))),
    ),
  })).filter((g) => g.items.length);
}
