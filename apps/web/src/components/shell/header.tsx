'use client';

import * as Dropdown from '@radix-ui/react-dropdown-menu';
import { Button, cn, Kbd, Tooltip } from '@ordens/ui';
import { useQueryClient } from '@tanstack/react-query';
import { NotificationsMenu } from '@/features/notifications/notifications-menu';
import { Building2, Check, ChevronRight, HelpCircle, LogOut, Menu, Monitor, Moon, Plus, Search, ShieldCheck, Sun } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useTheme } from 'next-themes';
import { toast } from 'sonner';
import { patch, post } from '@/lib/api';
import type { MeResponse } from '@ordens/contracts';
import { logout, ME_KEY, useCan, useMe } from '@/lib/session';
import { NAVIGATION } from './navigation';

const menuContent =
  'z-[60] min-w-56 rounded-lg bg-surface p-1 shadow-lg ring-1 ring-border data-[state=open]:animate-in data-[state=open]:fade-in data-[state=open]:zoom-in-95';
const menuItem =
  'flex h-9 cursor-pointer select-none items-center gap-2.5 rounded-md px-2.5 text-sm outline-none data-[highlighted]:bg-surface-2 [&_svg]:size-4 [&_svg]:text-muted';

function useBreadcrumb() {
  const pathname = usePathname();
  // Casamento mais específico: /documentos/nfe é "Notas Fiscais", não detalhe de "Central de Documentos".
  const match = NAVIGATION.flatMap((group) => group.items.map((item) => ({ group, item })))
    .filter(({ item }) => item.href !== '/' && (pathname === item.href || pathname.startsWith(`${item.href}/`)))
    .sort((a, b) => b.item.href.length - a.item.href.length)[0];
  if (match) {
    const crumbs: { label: string; href?: string }[] = [];
    if (match.group.label) crumbs.push({ label: match.group.label });
    crumbs.push({ label: match.item.label, href: match.item.href });
    if (pathname !== match.item.href) crumbs.push({ label: 'Detalhe' });
    return crumbs;
  }
  if (pathname.startsWith('/conta')) return [{ label: 'Minha conta' }, { label: 'Segurança' }];
  return [{ label: 'Visão geral' }];
}

export function Header({ onOpenMobileNav, onOpenPalette }: { onOpenMobileNav: () => void; onOpenPalette: () => void }) {
  const crumbs = useBreadcrumb();
  const router = useRouter();
  const can = useCan();

  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3 border-b border-border/70 bg-bg/80 px-4 backdrop-blur-md sm:px-6">
      <Button variant="ghost" size="icon-sm" className="lg:hidden" onClick={onOpenMobileNav} aria-label="Abrir menu">
        <Menu />
      </Button>

      <nav aria-label="Trilha" className="hidden min-w-0 items-center gap-1.5 text-[13px] md:flex">
        {crumbs.map((c, i) => (
          <span key={`${c.label}-${i}`} className="flex min-w-0 items-center gap-1.5">
            {i > 0 ? <ChevronRight className="size-3.5 shrink-0 text-subtle" /> : null}
            {c.href && i < crumbs.length - 1 ? (
              <Link href={c.href} className="truncate text-muted hover:text-text">
                {c.label}
              </Link>
            ) : (
              <span className={cn('truncate', i === crumbs.length - 1 ? 'font-medium text-text' : 'text-muted')}>{c.label}</span>
            )}
          </span>
        ))}
      </nav>

      <div className="ml-auto flex items-center gap-1.5">
        <button
          onClick={onOpenPalette}
          className="hidden h-9 w-64 items-center gap-2 rounded-md bg-surface-2 px-3 text-[13px] text-subtle ring-1 ring-inset ring-border/60 transition hover:bg-surface-3 hover:text-muted md:flex xl:w-80"
        >
          <Search className="size-4" />
          <span className="flex-1 text-left">Buscar OC, contrato, placa…</span>
          <Kbd>Ctrl</Kbd>
          <Kbd>K</Kbd>
        </button>
        <Button variant="ghost" size="icon-sm" className="md:hidden" onClick={onOpenPalette} aria-label="Buscar">
          <Search />
        </Button>

        {can('order.create') ? (
          <Button size="sm" className="hidden sm:inline-flex" onClick={() => router.push('/ordens?nova=1')}>
            <Plus /> Nova Ordem
          </Button>
        ) : null}

        <NotificationsMenu />
        <ThemeMenu />
        <Tooltip content="Ajuda">
          <Button variant="ghost" size="icon-sm" aria-label="Ajuda" className="hidden sm:inline-flex">
            <HelpCircle />
          </Button>
        </Tooltip>
        <UserMenu />
      </div>
    </header>
  );
}

function ThemeMenu() {
  const { theme, setTheme, resolvedTheme } = useTheme();
  const qc = useQueryClient();
  const options = [
    { value: 'light', label: 'Claro', icon: Sun },
    { value: 'dark', label: 'Escuro', icon: Moon },
    { value: 'system', label: 'Sistema', icon: Monitor },
  ] as const;
  const Current = resolvedTheme === 'dark' ? Moon : Sun;

  const choose = (value: (typeof options)[number]['value']) => {
    setTheme(value);
    // mantém o tema salvo em cache alinhado, para nenhum remount reaplicar o valor antigo
    qc.setQueryData<MeResponse>(ME_KEY, (me) => (me ? { ...me, user: { ...me.user, theme: value } } : me));
    patch('/me/preferences', { theme: value }).catch(() => undefined);
  };

  return (
    <Dropdown.Root>
      <Tooltip content="Tema">
        <Dropdown.Trigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label="Alterar tema">
            <Current className="transition-transform duration-300" />
          </Button>
        </Dropdown.Trigger>
      </Tooltip>
      <Dropdown.Portal>
        <Dropdown.Content align="end" sideOffset={6} className={cn(menuContent, 'min-w-40')}>
          {options.map((o) => (
            <Dropdown.Item key={o.value} className={menuItem} onSelect={() => choose(o.value)}>
              <o.icon />
              <span className="flex-1">{o.label}</span>
              {theme === o.value ? <Check className="!text-primary" /> : null}
            </Dropdown.Item>
          ))}
        </Dropdown.Content>
      </Dropdown.Portal>
    </Dropdown.Root>
  );
}

const SCOPE_LABEL: Record<string, string> = { MATRIZ: 'Matriz', FARM: 'Fazenda', BUYER: 'Comprador', CARRIER: 'Transportadora', PLATFORM: 'Plataforma' };

function UserMenu() {
  const { data: me } = useMe();
  const qc = useQueryClient();
  if (!me) return <div className="size-8 animate-pulse rounded-full bg-surface-3" />;
  const initials = me.user.name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0])
    .join('')
    .toUpperCase();

  const switchTo = async (membershipId: string) => {
    try {
      await post('/auth/context', { membershipId });
      qc.clear();
      window.location.href = '/';
    } catch {
      toast.error('Não foi possível trocar de organização.');
    }
  };

  return (
    <Dropdown.Root>
      <Dropdown.Trigger asChild>
        <button className="ml-1 flex items-center gap-2 rounded-full p-0.5 pr-0.5 transition hover:bg-surface-2 sm:pr-2.5" aria-label="Menu do usuário">
          <span className="grid size-8 place-items-center rounded-full bg-gradient-to-br from-violet-500 to-indigo-600 text-xs font-semibold text-white">{initials}</span>
          <span className="hidden text-left leading-tight sm:block">
            <span className="block max-w-32 truncate text-[13px] font-medium">{me.user.name.split(' ')[0]}</span>
            <span className="block max-w-32 truncate text-[11px] text-subtle">{SCOPE_LABEL[me.activeMembership?.scope ?? ''] ?? '—'}</span>
          </span>
        </button>
      </Dropdown.Trigger>
      <Dropdown.Portal>
        <Dropdown.Content align="end" sideOffset={6} className={cn(menuContent, 'w-72')}>
          <div className="px-2.5 py-2">
            <div className="truncate text-sm font-medium">{me.user.name}</div>
            <div className="truncate text-xs text-subtle">{me.user.email}</div>
          </div>
          <Dropdown.Separator className="my-1 h-px bg-border" />
          {me.memberships.length > 0 ? (
            <>
              <Dropdown.Label className="px-2.5 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wider text-subtle">Organizações</Dropdown.Label>
              {me.memberships.map((m) => (
                <Dropdown.Item key={m.id} className={cn(menuItem, 'h-auto py-2')} onSelect={() => m.id !== me.activeMembership?.id && switchTo(m.id)}>
                  <Building2 />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{m.organization.name}</span>
                    <span className="block truncate text-xs text-subtle">
                      {m.tenant.name} · {SCOPE_LABEL[m.scope]}
                    </span>
                  </span>
                  {m.id === me.activeMembership?.id ? <Check className="!text-primary" /> : null}
                </Dropdown.Item>
              ))}
              <Dropdown.Separator className="my-1 h-px bg-border" />
            </>
          ) : null}
          <Dropdown.Item asChild className={menuItem}>
            <Link href="/conta/seguranca">
              <ShieldCheck /> Preferências e segurança
            </Link>
          </Dropdown.Item>
          <Dropdown.Item className={cn(menuItem, 'text-danger [&_svg]:!text-danger')} onSelect={() => void logout()}>
            <LogOut /> Sair
          </Dropdown.Item>
        </Dropdown.Content>
      </Dropdown.Portal>
    </Dropdown.Root>
  );
}
