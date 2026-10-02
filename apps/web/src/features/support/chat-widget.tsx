'use client';

import { SUPPORT_QUEUE_LABELS } from '@ordens/contracts';
import { Badge, Button, cn, Skeleton } from '@ordens/ui';
import { ArrowLeft, MessageCircle, MessageSquarePlus, UserCheck, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { ApiRequestError } from '@/lib/api';
import { formatRelative } from '@/lib/format';
import { useCan } from '@/lib/session';
import { ConversationThread, SupportStatusBadge } from './conversation-thread';
import { useConversation, useMyConversations, useSupportAccess, useSupportMutations, useSupportQueue } from './support-api';

const errorMessage = (err: unknown) => (err instanceof ApiRequestError ? err.message : 'Não foi possível enviar. Tente novamente.');

/** Chat de atendimento flutuante: conversas do usuário com o assistente de triagem e a equipe. */
export function ChatWidget() {
  const can = useCan();
  const enabled = can('support.use');
  const [open, setOpen] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  // Quem atende enxerga a fila aqui mesmo; a aba só existe para quem está em alguma equipe.
  const access = useSupportAccess();
  const attends = access.queues.length > 0;
  const [tab, setTab] = useState<'mine' | 'queue' | 'working'>('mine');
  // Conversa aberta pela fila é respondida como atendente (nota interna, sem respostas rápidas).
  const [asAgent, setAsAgent] = useState(false);
  const params = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const mine = useMyConversations(enabled);
  const queue = useSupportQueue({ status: ['WAITING'] }, open && attends);
  // "Em atendimento": o que esta pessoa assumiu e ainda não encerrou, inclusive o que aguarda o cliente.
  const working = useSupportQueue({ status: ['OPEN', 'PENDING_CUSTOMER'], assignee: 'me' }, open && attends);
  const conversation = useConversation(open ? activeId : null);
  const { start, send, close, assign } = useSupportMutations();

  // Link de notificação (?atendimento=<id>) abre direto a conversa.
  const deepLink = params.get('atendimento');
  useEffect(() => {
    if (!deepLink) return;
    setAsAgent(false);
    setActiveId(deepLink);
    setOpen(true);
    const next = new URLSearchParams(params.toString());
    next.delete('atendimento');
    router.replace(next.size ? `${pathname}?${next}` : pathname, { scroll: false });
  }, [deepLink, params, pathname, router]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (!enabled) return null;

  const awaitingMe = (mine.data ?? []).filter((c) => c.status === 'PENDING_CUSTOMER').length;
  const waiting = attends ? (queue.data?.items.length ?? 0) : 0;
  const workingItems = working.data?.items ?? [];
  const badge = awaitingMe + waiting;

  const openConversation = (id: string, agent: boolean) => {
    setAsAgent(agent);
    setActiveId(id);
  };

  /** Assume o atendimento e já abre a conversa para responder, sem passar pelo painel. */
  const take = async (id: string) => {
    if (!access.userId) return;
    try {
      await assign.mutateAsync({ id, assigneeUserId: access.userId });
      openConversation(id, true);
      toast.success('Atendimento assumido');
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const newConversation = async () => {
    try {
      const created = await start.mutateAsync({});
      openConversation(created.id, false);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const detail = conversation.data;

  return (
    <>
      <AnimatePresence>
        {open ? (
          <motion.section
            role="dialog"
            aria-label="Atendimento"
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="fixed bottom-20 right-4 z-40 flex h-[min(640px,calc(100dvh-112px))] w-[min(400px,calc(100vw-32px))] flex-col overflow-hidden rounded-2xl bg-surface shadow-2xl ring-1 ring-border"
          >
            <header className="flex items-center gap-2 border-b border-border/70 bg-primary px-3 py-3 text-primary-fg">
              {activeId ? (
                <button onClick={() => setActiveId(null)} aria-label="Voltar para as conversas" className="grid size-8 place-items-center rounded-md hover:bg-white/10">
                  <ArrowLeft className="size-4" />
                </button>
              ) : null}
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold">{detail && activeId ? `Atendimento ${detail.number}` : 'Atendimento'}</div>
                <div className="truncate text-xs text-primary-fg/80">
                  {detail && activeId ? (detail.subject ?? 'Faturamento e suporte') : 'Faturamento e suporte, direto por aqui'}
                </div>
              </div>
              <button onClick={() => setOpen(false)} aria-label="Fechar atendimento" className="grid size-8 place-items-center rounded-md hover:bg-white/10">
                <X className="size-4" />
              </button>
            </header>

            {activeId ? (
              !detail ? (
                <div className="space-y-3 p-4">
                  <Skeleton className="h-16" />
                  <Skeleton className="ml-auto h-10 w-2/3" />
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between gap-2 border-b border-border/60 px-4 py-2">
                    <SupportStatusBadge status={detail.status} />
                    {detail.status !== 'CLOSED' ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        loading={close.isPending}
                        onClick={() => close.mutate(detail.id, { onError: (err) => toast.error(errorMessage(err)) })}
                      >
                        Encerrar
                      </Button>
                    ) : null}
                  </div>
                  <ConversationThread
                    conversation={detail}
                    mode={asAgent ? 'agent' : 'customer'}
                    sending={send.isPending}
                    onSend={(body, internal, attachmentIds) => send.mutateAsync({ id: detail.id, body, internal, attachmentIds }).catch((err) => {
                      toast.error(errorMessage(err));
                      throw err;
                    })}
                    onQuickReply={asAgent ? undefined : (action) => send.mutate({ id: detail.id, quickReply: action }, { onError: (err) => toast.error(errorMessage(err)) })}
                    onNewConversation={asAgent ? undefined : () => void newConversation()}
                  />
                </>
              )
            ) : (
              <div className="flex min-h-0 flex-1 flex-col">
                {attends ? (
                  <div className="flex gap-1 border-b border-border/60 px-3 pt-3" role="tablist" aria-label="Atendimento">
                    {[
                      { key: 'mine' as const, label: 'Minhas conversas', count: awaitingMe },
                      { key: 'queue' as const, label: 'Na fila', count: waiting },
                      { key: 'working' as const, label: 'Em atendimento', count: workingItems.length },
                    ].map((t) => (
                      <button
                        key={t.key}
                        role="tab"
                        aria-selected={tab === t.key}
                        onClick={() => setTab(t.key)}
                        className={cn(
                          'flex items-center gap-1.5 rounded-t-md px-3 py-2 text-sm font-medium transition',
                          tab === t.key ? 'bg-surface-2 text-text' : 'text-muted hover:text-text',
                        )}
                      >
                        {t.label}
                        {t.count ? <Badge tone={t.key === 'queue' ? 'warning' : t.key === 'working' ? 'info' : 'primary'}>{t.count}</Badge> : null}
                      </button>
                    ))}
                  </div>
                ) : null}
                {tab === 'mine' ? (
                  <div className="p-4">
                    <Button className="w-full" onClick={() => void newConversation()} loading={start.isPending}>
                      <MessageSquarePlus /> Nova conversa
                    </Button>
                  </div>
                ) : null}
                <div className="min-h-0 flex-1 overflow-y-auto border-t border-border/60">
                  {tab === 'working' ? (
                    working.isLoading ? (
                      <div className="space-y-2 p-4">
                        <Skeleton className="h-14" />
                        <Skeleton className="h-14" />
                      </div>
                    ) : !workingItems.length ? (
                      <p className="px-6 py-10 text-center text-sm text-muted">Você não está atendendo nenhuma conversa agora.</p>
                    ) : (
                      <ul className="divide-y divide-border/60">
                        {workingItems.map((c) => (
                          <li key={c.id}>
                            <button onClick={() => openConversation(c.id, true)} className="flex w-full flex-col gap-1 px-4 py-3 text-left transition hover:bg-surface-2">
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-mono text-xs text-muted">{c.number}</span>
                                <span className="text-[11px] text-subtle">{formatRelative(c.lastMessageAt)}</span>
                              </div>
                              <span className="truncate text-sm font-medium">{c.subject ?? 'Sem assunto'}</span>
                              <span className="truncate text-xs text-muted">
                                {c.requester.name}
                                {c.requester.organization ? ` · ${c.requester.organization}` : ''}
                              </span>
                              <span className="flex items-center gap-1.5">
                                <SupportStatusBadge status={c.status} />
                                {c.queue ? <Badge tone="neutral">{SUPPORT_QUEUE_LABELS[c.queue]}</Badge> : null}
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )
                  ) : tab === 'queue' ? (
                    queue.isLoading ? (
                      <div className="space-y-2 p-4">
                        <Skeleton className="h-14" />
                        <Skeleton className="h-14" />
                      </div>
                    ) : !queue.data?.items.length ? (
                      <p className="px-6 py-10 text-center text-sm text-muted">Nenhuma conversa esperando nas suas filas.</p>
                    ) : (
                      <ul className="divide-y divide-border/60">
                        {queue.data.items.map((c) => (
                          <li key={c.id} className="px-4 py-3">
                            <button onClick={() => openConversation(c.id, true)} className="flex w-full flex-col gap-1 text-left">
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-mono text-xs text-muted">{c.number}</span>
                                <span className="text-[11px] text-subtle">{formatRelative(c.lastMessageAt)}</span>
                              </div>
                              <span className="truncate text-sm font-medium">{c.subject ?? 'Sem assunto'}</span>
                              <span className="truncate text-xs text-muted">
                                {c.requester.name}
                                {c.requester.organization ? ` · ${c.requester.organization}` : ''}
                              </span>
                              {c.queue ? <Badge tone="neutral">{SUPPORT_QUEUE_LABELS[c.queue]}</Badge> : null}
                            </button>
                            <Button variant="soft" size="sm" className="mt-2 w-full" loading={assign.isPending} onClick={() => void take(c.id)}>
                              <UserCheck /> Assumir
                            </Button>
                          </li>
                        ))}
                      </ul>
                    )
                  ) : mine.isLoading ? (
                    <div className="space-y-2 p-4">
                      <Skeleton className="h-14" />
                      <Skeleton className="h-14" />
                    </div>
                  ) : !mine.data?.length ? (
                    <p className="px-6 py-10 text-center text-sm text-muted">Nenhuma conversa ainda. O assistente te direciona para o Faturamento ou o Suporte.</p>
                  ) : (
                    <ul className="divide-y divide-border/60">
                      {mine.data.map((c) => (
                        <li key={c.id}>
                          <button onClick={() => openConversation(c.id, false)} className="flex w-full flex-col gap-1 px-4 py-3 text-left transition hover:bg-surface-2">
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-mono text-xs text-muted">{c.number}</span>
                              <span className="text-[11px] text-subtle">{formatRelative(c.lastMessageAt)}</span>
                            </div>
                            <span className="truncate text-sm font-medium">{c.subject ?? 'Conversa com o assistente'}</span>
                            <span className="truncate text-xs text-muted">{c.lastMessagePreview}</span>
                            <span>
                              <SupportStatusBadge status={c.status} />
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}
          </motion.section>
        ) : null}
      </AnimatePresence>

      <motion.button
        whileHover={{ scale: 1.04 }}
        whileTap={{ scale: 0.96 }}
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? 'Fechar atendimento' : badge ? `Abrir atendimento, ${badge} aguardando resposta` : 'Abrir atendimento'}
        aria-expanded={open}
        className={cn('fixed bottom-4 right-4 z-40 grid size-13 place-items-center rounded-full bg-primary text-primary-fg shadow-xl shadow-primary/30 ring-4 ring-bg')}
      >
        {open ? <X className="size-5" /> : <MessageCircle className="size-5" />}
        {!open && badge ? (
          <span className="absolute -right-0.5 -top-0.5 grid h-5 min-w-5 place-items-center rounded-full bg-danger px-1 text-[11px] font-semibold text-white ring-2 ring-bg">{badge}</span>
        ) : null}
      </motion.button>
    </>
  );
}
