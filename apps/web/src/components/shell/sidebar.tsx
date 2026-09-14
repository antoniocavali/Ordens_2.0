'use client';

import { cn, Tooltip } from '@ordens/ui';
import { ChevronsLeft } from 'lucide-react';
import { motion } from 'motion/react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Logo } from '@/features/auth/auth-showcase';
import { useCan, useMe } from '@/lib/session';
import { visibleNavigation } from './navigation';

export function Sidebar({ collapsed, onToggle, onNavigate }: { collapsed: boolean; onToggle?: () => void; onNavigate?: () => void }) {
  const pathname = usePathname();
  const can = useCan();
  const { data: me } = useMe();
  const groups = visibleNavigation(can, me?.activeMembership?.scope, me?.supportQueues);

  // Item mais específico vence (ex.: /documentos/nfe ativa só "Notas Fiscais", não "Central de Documentos").
  const current = groups
    .flatMap((g) => g.items.map((i) => i.href))
    .filter((href) => href !== '/' && (pathname === href || pathname.startsWith(`${href}/`)))
    .sort((a, b) => b.length - a.length)[0];
  const isActive = (href: string) => (href === '/' ? pathname === '/' : href === current);

  return (
    <motion.nav
      aria-label="Navegação principal"
      animate={{ width: collapsed ? 68 : 264 }}
      transition={{ type: 'spring', stiffness: 420, damping: 40 }}
      className="flex h-full flex-col overflow-hidden bg-nav text-nav-fg"
    >
      <div className={cn('flex h-14 shrink-0 items-center gap-2.5 border-b border-nav-border', collapsed ? 'justify-center px-0' : 'px-4')}>
        <Logo className="size-8 shrink-0" />
        {!collapsed ? (
          <div className="min-w-0 leading-tight">
            <div className="text-[15px] font-semibold tracking-tight text-white">Ordens</div>
            <div className="truncate text-[11px] text-nav-muted">{me?.activeMembership?.tenant.name ?? 'TMS'}</div>
          </div>
        ) : null}
      </div>

      <div className="flex-1 space-y-5 overflow-y-auto overflow-x-hidden px-2.5 py-4 [scrollbar-color:var(--nav-active)_transparent]">
        {groups.map((group, gi) => (
          <div key={group.label ?? gi} className="space-y-0.5">
            {group.label && !collapsed ? (
              <div className="px-2.5 pb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.09em] text-nav-muted">{group.label}</div>
            ) : group.label ? (
              <div className="mx-auto mb-1.5 h-px w-6 bg-nav-border" />
            ) : null}
            {group.items.map((item) => {
              const active = isActive(item.href);
              const content = (
                <>
                  {active ? (
                    <motion.span
                      layoutId="nav-active"
                      className="absolute inset-0 rounded-md bg-nav-active ring-1 ring-white/5"
                      transition={{ type: 'spring', stiffness: 500, damping: 40 }}
                    />
                  ) : null}
                  {active ? <span className="absolute inset-y-2 left-0 w-[3px] rounded-r bg-violet-400" /> : null}
                  <item.icon className={cn('relative size-[18px] shrink-0', active ? 'text-violet-300' : 'text-nav-muted group-hover:text-nav-fg')} />
                  {!collapsed ? <span className="relative truncate whitespace-nowrap">{item.label}</span> : null}
                </>
              );
              const cls = cn(
                'group relative flex h-9 items-center gap-3 rounded-md text-[13.5px] font-medium transition-colors',
                collapsed ? 'justify-center px-0' : 'px-2.5',
                active ? 'text-white' : 'text-nav-fg/85 hover:bg-white/[0.04] hover:text-white',
                item.soon && 'cursor-default opacity-45 hover:bg-transparent hover:text-nav-fg/85',
              );
              const node = item.soon ? (
                <span aria-disabled className={cls}>
                  {content}
                </span>
              ) : (
                <Link href={item.href} onClick={onNavigate} aria-current={active ? 'page' : undefined} className={cls}>
                  {content}
                </Link>
              );
              return (
                <Tooltip key={item.href} side="right" content={collapsed ? `${item.label}${item.soon ? ' · em breve' : ''}` : item.soon ? 'Disponível nas próximas fases' : null}>
                  {node}
                </Tooltip>
              );
            })}
          </div>
        ))}
      </div>

      {onToggle ? (
        <div className="shrink-0 border-t border-nav-border p-2.5">
          <button
            onClick={onToggle}
            className={cn('flex h-9 w-full items-center gap-3 rounded-md text-[13px] text-nav-muted transition hover:bg-white/[0.04] hover:text-white', collapsed ? 'justify-center' : 'px-2.5')}
            aria-label={collapsed ? 'Expandir menu' : 'Recolher menu'}
          >
            <ChevronsLeft className={cn('size-[18px] transition-transform duration-300', collapsed && 'rotate-180')} />
            {!collapsed ? 'Recolher' : null}
          </button>
        </div>
      ) : null}
    </motion.nav>
  );
}
