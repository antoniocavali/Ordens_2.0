'use client';

import { Button, cn, Skeleton } from '@ordens/ui';
import { ArrowLeft, MessageCircle, MessageSquarePlus, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { ApiRequestError } from '@/lib/api';
import { formatRelative } from '@/lib/format';
import { useCan } from '@/lib/session';
import { ConversationThread, SupportStatusBadge } from './conversation-thread';
import { useConversation, useMyConversations, useSupportMutations } from './support-api';

const errorMessage = (err: unknown) => (err instanceof ApiRequestError ? err.message : 'Não foi possível enviar. Tente novamente.');

/** Chat de atendimento flutuante: conversas do usuário com o assistente de triagem e a equipe. */
export function ChatWidget() {
  const can = useCan();
  const enabled = can('support.use');
  const [open, setOpen] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const params = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const mine = useMyConversations(enabled);
  const conversation = useConversation(open ? activeId : null);
  const { start, send, close } = useSupportMutations();

  // Link de notificação (?atendimento=<id>) abre direto a conversa.
  const deepLink = params.get('atendimento');
  useEffect(() => {
    if (!deepLink) return;
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

  const newConversation = async () => {
    try {
      const created = await start.mutateAsync({});
      setActiveId(created.id);
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
                    mode="customer"
                    sending={send.isPending}
                    onSend={(body) => send.mutateAsync({ id: detail.id, body }).catch((err) => {
                      toast.error(errorMessage(err));
                      throw err;
                    })}
                    onQuickReply={(action) => send.mutate({ id: detail.id, quickReply: action }, { onError: (err) => toast.error(errorMessage(err)) })}
                  />
                </>
              )
            ) : (
              <div className="flex min-h-0 flex-1 flex-col">
                <div className="p-4">
                  <Button className="w-full" onClick={() => void newConversation()} loading={start.isPending}>
                    <MessageSquarePlus /> Nova conversa
                  </Button>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto border-t border-border/60">
                  {mine.isLoading ? (
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
                          <button onClick={() => setActiveId(c.id)} className="flex w-full flex-col gap-1 px-4 py-3 text-left transition hover:bg-surface-2">
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
        aria-label={open ? 'Fechar atendimento' : awaitingMe ? `Abrir atendimento, ${awaitingMe} aguardando sua resposta` : 'Abrir atendimento'}
        aria-expanded={open}
        className={cn('fixed bottom-4 right-4 z-40 grid size-13 place-items-center rounded-full bg-primary text-primary-fg shadow-xl shadow-primary/30 ring-4 ring-bg')}
      >
        {open ? <X className="size-5" /> : <MessageCircle className="size-5" />}
        {!open && awaitingMe ? (
          <span className="absolute -right-0.5 -top-0.5 grid h-5 min-w-5 place-items-center rounded-full bg-danger px-1 text-[11px] font-semibold text-white ring-2 ring-bg">{awaitingMe}</span>
        ) : null}
      </motion.button>
    </>
  );
}
