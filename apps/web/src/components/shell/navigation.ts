import type { Permission, Scope } from '@ordens/contracts';
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
  History,
  MapPin,
  Package,
  PackageCheck,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sprout,
  Truck,
  UserRound,
  Users,
  Wheat,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  permission?: Permission;
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
      { label: 'Liberações', href: '/liberacoes', icon: PackageCheck, permission: 'order.read', soon: true },
      { label: 'Agendamentos', href: '/agendamentos', icon: CalendarClock, permission: 'appointment.read', soon: true },
      { label: 'Cargas', href: '/cargas', icon: Truck, permission: 'load.read', soon: true },
      { label: 'Ocorrências', href: '/ocorrencias', icon: AlertTriangle, permission: 'occurrence.read', soon: true },
    ],
  },
  {
    label: 'Documentos',
    items: [
      { label: 'Central de Documentos', href: '/documentos', icon: FileText, permission: 'document.read', soon: true },
      { label: 'Notas Fiscais', href: '/documentos/nfe', icon: FileSpreadsheet, permission: 'document.read', soon: true },
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
      { label: 'Locais', href: '/cadastros/locais', icon: MapPin, permission: 'partner.manage', soon: true },
    ],
  },
  {
    label: 'Gestão',
    items: [
      { label: 'Relatórios', href: '/gestao/relatorios', icon: BarChart3, permission: 'report.export', soon: true },
      { label: 'Auditoria', href: '/gestao/auditoria', icon: History, permission: 'audit.read', soon: true },
      { label: 'Usuários', href: '/gestao/usuarios', icon: Users, permission: 'user.read', soon: true },
    ],
  },
  {
    label: 'Configurações',
    items: [
      { label: 'Segurança', href: '/configuracoes/seguranca', icon: ShieldCheck, permission: 'security.policy.manage', soon: true },
      { label: 'Preferências', href: '/conta/seguranca', icon: SlidersHorizontal },
      { label: 'Workflow', href: '/configuracoes/workflow', icon: Settings2, permission: 'settings.manage', soon: true },
    ],
  },
];

export function visibleNavigation(can: (p: Permission) => boolean, scope: Scope | undefined): NavGroup[] {
  return NAVIGATION.map((g) => ({
    ...g,
    items: g.items.filter((i) => (!i.permission || can(i.permission)) && (!i.scopes || (scope && i.scopes.includes(scope)))),
  })).filter((g) => g.items.length);
}
