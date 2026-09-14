'use client';

import * as Dialog from '@radix-ui/react-dialog';
import type { OrderListItem, Page } from '@ordens/contracts';
import { Kbd } from '@ordens/ui';
import { useQuery } from '@tanstack/react-query';
import { Command } from 'cmdk';
import { ClipboardList, Moon, Plus, Search, ShieldCheck, Sun } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';
import { get } from '@/lib/api';
import { useCan, useMe } from '@/lib/session';
import { visibleNavigation } from './navigation';

const itemCls =
  'flex h-10 cursor-pointer select-none items-center gap-3 rounded-md px-3 text-sm text-text data-[selected=true]:bg-primary-soft [&_svg]:size-4 [&_svg]:text-muted data-[selected=true]:[&_svg]:text-primary';

export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const router = useRouter();
  const can = useCan();
  const { data: me } = useMe();
  const { setTheme, resolvedTheme } = useTheme();
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 200);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        onOpenChange(!open);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onOpenChange]);

  const orders = useQuery({
    queryKey: ['palette', 'orders', debounced],
    queryFn: () => get<Page<OrderListItem>>('/orders', { q: debounced, pageSize: 10 }),
    enabled: open && debounced.length >= 2 && can('order.read'),
  });

  const go = (href: string) => {
    onOpenChange(false);
    setSearch('');
    router.push(href);
  };

  const nav = visibleNavigation(can, me?.activeMembership?.scope, me?.supportQueues).flatMap((g) => g.items.filter((i) => !i.soon));

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[60] bg-[var(--overlay)] backdrop-blur-[2px] data-[state=open]:animate-in data-[state=open]:fade-in" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed left-1/2 top-[12vh] z-[61] w-[min(640px,calc(100vw-24px))] -translate-x-1/2 overflow-hidden rounded-xl bg-surface shadow-lg ring-1 ring-border data-[state=open]:animate-in data-[state=open]:fade-in data-[state=open]:slide-in-from-top-2"
        >
          <Dialog.Title className="sr-only">Busca global</Dialog.Title>
          <Command shouldFilter={debounced.length < 2} loop>
            <div className="flex items-center gap-3 border-b border-border/70 px-4">
              <Search className="size-4 text-subtle" />
              <Command.Input
                value={search}
                onValueChange={setSearch}
                placeholder="Buscar ordens, navegar, executar ações…"
                className="h-13 flex-1 bg-transparent py-4 text-[15px] outline-none placeholder:text-subtle"
              />
              <Kbd>Esc</Kbd>
            </div>
            <Command.List className="max-h-[min(60vh,440px)] overflow-y-auto p-2">
              <Command.Empty className="py-10 text-center text-sm text-muted">
                {orders.isFetching ? 'Buscando…' : 'Nenhum resultado.'}
              </Command.Empty>

              {orders.data?.items.length ? (
                <Command.Group heading="Ordens de carregamento" className="mb-2 [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-subtle">
                  {orders.data.items.map((o) => (
                    <Command.Item key={o.id} value={`oc-${o.id}`} onSelect={() => go(`/ordens/${o.id}`)} className={itemCls}>
                      <ClipboardList />
                      <span className="font-mono text-[13px]">{o.number}</span>
                      <span className="truncate text-muted">
                        {o.commodity?.name} · {o.farm?.name ?? o.seller?.name}
                      </span>
                    </Command.Item>
                  ))}
                </Command.Group>
              ) : null}

              <Command.Group heading="Ações" className="mb-2 [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-subtle">
                {can('order.create') ? (
                  <Command.Item value="nova ordem criar" onSelect={() => go('/ordens?nova=1')} className={itemCls}>
                    <Plus /> Nova Ordem de Carregamento
                  </Command.Item>
                ) : null}
                <Command.Item
                  value="alternar tema escuro claro"
                  onSelect={() => {
                    setTheme(resolvedTheme === 'dark' ? 'light' : 'dark');
                    onOpenChange(false);
                  }}
                  className={itemCls}
                >
                  {resolvedTheme === 'dark' ? <Sun /> : <Moon />} Alternar tema
                </Command.Item>
                <Command.Item value="segurança conta 2fa senha sessões" onSelect={() => go('/conta/seguranca')} className={itemCls}>
                  <ShieldCheck /> Segurança da conta
                </Command.Item>
              </Command.Group>

              <Command.Group heading="Navegar" className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-subtle">
                {nav.map((i) => (
                  <Command.Item key={i.href} value={`ir ${i.label}`} onSelect={() => go(i.href)} className={itemCls}>
                    <i.icon /> {i.label}
                  </Command.Item>
                ))}
              </Command.Group>
            </Command.List>
          </Command>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
