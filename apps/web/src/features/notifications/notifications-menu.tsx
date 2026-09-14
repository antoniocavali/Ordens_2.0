'use client';

import * as Dropdown from '@radix-ui/react-dropdown-menu';
import type { NotificationDto, NotificationsPage } from '@ordens/contracts';
import { Button, cn } from '@ordens/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, CheckCheck, Inbox } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { get, post } from '@/lib/api';
import { formatRelative } from '@/lib/format';
import { useRealtime } from '@/lib/realtime';

export function NotificationsMenu() {
  useRealtime();
  const qc = useQueryClient();
  const router = useRouter();
  // Polling de segurança: mantém o contador correto mesmo sem o stream de tempo real.
  const list = useQuery({ queryKey: ['notifications'], queryFn: () => get<NotificationsPage>('/notifications', { limit: 20 }), refetchInterval: 60_000 });
  const unread = list.data?.unread ?? 0;
  const invalidate = () => void qc.invalidateQueries({ queryKey: ['notifications'] });
  const readAll = useMutation({ mutationFn: () => post('/notifications/read-all'), onSuccess: invalidate });

  // Toast apenas para avisos que chegaram depois da primeira carga.
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => {
    const items = list.data?.items;
    if (!items) return;
    if (seen.current) {
      const fresh = items.filter((n) => !n.readAt && !seen.current!.has(n.id));
      const first = fresh[0];
      if (first) {
        toast(first.title, {
          description: fresh.length > 1 ? `e mais ${fresh.length - 1} aviso(s)` : (first.body ?? undefined),
          action: first.href ? { label: 'Abrir', onClick: () => router.push(first.href!) } : undefined,
        });
      }
    }
    seen.current = new Set(items.map((n) => n.id));
  }, [list.data, router]);

  const open = async (n: NotificationDto) => {
    if (!n.readAt) await post(`/notifications/${n.id}/read`).catch(() => undefined);
    invalidate();
    if (n.href) router.push(n.href);
  };

  return (
    <Dropdown.Root>
      <Dropdown.Trigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={unread ? `Notificações, ${unread} não lidas` : 'Notificações'} className="relative">
          <Bell />
          {unread ? (
            <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-none text-primary-fg ring-2 ring-bg">
              {unread > 9 ? '9+' : unread}
            </span>
          ) : null}
        </Button>
      </Dropdown.Trigger>
      <Dropdown.Portal>
        <Dropdown.Content
          align="end"
          sideOffset={8}
          className="z-[60] w-[min(380px,calc(100vw-24px))] overflow-hidden rounded-lg bg-surface shadow-lg ring-1 ring-border data-[state=open]:animate-in data-[state=open]:fade-in data-[state=open]:zoom-in-95"
        >
          <div className="flex items-center justify-between border-b border-border/70 px-4 py-3">
            <span className="text-sm font-semibold">Notificações</span>
            {unread ? (
              <button onClick={() => readAll.mutate()} className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                <CheckCheck className="size-3.5" /> Marcar todas como lidas
              </button>
            ) : null}
          </div>
          <div className="max-h-[420px] overflow-y-auto py-1">
            {!list.data?.items.length ? (
              <div className="flex flex-col items-center gap-2 px-6 py-10 text-center text-sm text-muted">
                <Inbox className="size-6 text-subtle" />
                Nenhuma notificação por enquanto.
              </div>
            ) : (
              list.data.items.map((n) => (
                <Dropdown.Item
                  key={n.id}
                  onSelect={() => void open(n)}
                  className="flex cursor-pointer gap-3 px-4 py-3 outline-none data-[highlighted]:bg-surface-2"
                >
                  <span className={cn('mt-1.5 size-2 shrink-0 rounded-full', n.readAt ? 'bg-transparent' : 'bg-primary')} aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className={cn('block text-sm', !n.readAt && 'font-medium')}>
                      {n.title}
                      {!n.readAt ? <span className="sr-only"> (não lida)</span> : null}
                    </span>
                    {n.body ? <span className="block text-xs text-muted">{n.body}</span> : null}
                    <span className="mt-0.5 block text-[11px] text-subtle">{formatRelative(n.createdAt)}</span>
                  </span>
                </Dropdown.Item>
              ))
            )}
          </div>
        </Dropdown.Content>
      </Dropdown.Portal>
    </Dropdown.Root>
  );
}
