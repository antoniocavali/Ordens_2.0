'use client';

import { SUPPORT_STATUS_LABELS, type SupportBotAction, type SupportConversationDetail, type SupportStatus } from '@ordens/contracts';
import { Badge, Button, cn } from '@ordens/ui';
import { Bot, CheckCircle2, CircleDot, Clock, Headphones, Lock, MessageCircleQuestion, Send, UserRound, XCircle, type LucideIcon } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { formatDateTime, formatTime } from '@/lib/format';

type Tone = 'neutral' | 'primary' | 'info' | 'warning' | 'success' | 'danger';
const STATUS_UI: Record<SupportStatus, { tone: Tone; icon: LucideIcon }> = {
  BOT: { tone: 'neutral', icon: Bot },
  WAITING: { tone: 'warning', icon: Clock },
  OPEN: { tone: 'info', icon: Headphones },
  PENDING_CUSTOMER: { tone: 'primary', icon: MessageCircleQuestion },
  RESOLVED: { tone: 'success', icon: CheckCircle2 },
  CLOSED: { tone: 'neutral', icon: XCircle },
};

export function SupportStatusBadge({ status }: { status: SupportStatus }) {
  const { tone, icon: Icon } = STATUS_UI[status];
  return (
    <Badge tone={tone} size="sm">
      <Icon /> {SUPPORT_STATUS_LABELS[status]}
    </Badge>
  );
}

/**
 * Conversa de atendimento compartilhada entre o chat (cliente) e o painel (atendente).
 * Cliente: mensagens próprias à direita. Atendente: mensagens da equipe à direita e notas internas destacadas.
 */
export function ConversationThread({
  conversation,
  mode,
  sending,
  onSend,
  onQuickReply,
  onNewConversation,
}: {
  conversation: SupportConversationDetail;
  mode: 'customer' | 'agent';
  sending?: boolean;
  onSend: (body: string, internal: boolean) => Promise<unknown> | void;
  onQuickReply?: (action: SupportBotAction) => void;
  /** Chat do cliente: conversa resolvida não reabre (Q29), oferece abrir outra. */
  onNewConversation?: () => void;
}) {
  const [draft, setDraft] = useState('');
  const [internal, setInternal] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const resolvedForCustomer = mode === 'customer' && conversation.status === 'RESOLVED';
  const closed = conversation.status === 'CLOSED' || resolvedForCustomer;
  const agentBlocked = mode === 'agent' && conversation.status === 'BOT';

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [conversation.messages.length]);

  // Foco sem rolar a página (no painel, a conversa fica abaixo dos indicadores).
  useEffect(() => {
    inputRef.current?.focus({ preventScroll: true });
  }, [conversation.id]);

  const submit = async () => {
    const body = draft.trim();
    if (!body || sending) return;
    setDraft('');
    try {
      await onSend(body, mode === 'agent' && internal);
    } catch {
      setDraft(body);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void submit();
    }
  };

  const mine = (authorType: string) => (mode === 'customer' ? authorType === 'CUSTOMER' : authorType === 'AGENT');

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div ref={listRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4" aria-live="polite" aria-label={`Mensagens da conversa ${conversation.number}`}>
        <AnimatePresence initial={false}>
          {conversation.messages.map((m) => {
            if (m.authorType === 'SYSTEM') {
              return (
                <motion.div key={m.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex justify-center">
                  <span className={cn('rounded-full px-3 py-1 text-[11px]', m.internal ? 'bg-warning-soft text-warning' : 'bg-surface-2 text-muted')}>
                    {m.body} · {formatTime(m.createdAt)}
                  </span>
                </motion.div>
              );
            }
            const own = mine(m.authorType);
            const Icon = m.authorType === 'BOT' ? Bot : m.authorType === 'AGENT' ? Headphones : UserRound;
            return (
              <motion.div key={m.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className={cn('flex gap-2', own && 'flex-row-reverse')}>
                {!own ? (
                  <span className={cn('mt-5 grid size-7 shrink-0 place-items-center rounded-full', m.authorType === 'BOT' ? 'bg-primary-soft text-primary' : 'bg-surface-3 text-muted')}>
                    <Icon className="size-4" />
                  </span>
                ) : null}
                <div className={cn('flex max-w-[82%] flex-col gap-1', own && 'items-end')}>
                  <span className="px-1 text-[11px] text-subtle" title={formatDateTime(m.createdAt)}>
                    {m.authorType === 'BOT' ? 'Assistente' : (m.author?.name ?? (m.authorType === 'AGENT' ? 'Atendente' : 'Cliente'))} · {formatTime(m.createdAt)}
                  </span>
                  <div
                    className={cn(
                      'whitespace-pre-wrap wrap-break-word rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed',
                      m.internal
                        ? 'rounded-tr-sm bg-warning-soft text-text ring-1 ring-warning/40'
                        : own
                          ? 'rounded-tr-sm bg-primary text-primary-fg'
                          : 'rounded-tl-sm bg-surface-2 text-text',
                    )}
                  >
                    {m.internal ? (
                      <span className="mb-1 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-warning">
                        <Lock className="size-3" /> Nota interna
                      </span>
                    ) : null}
                    {m.body}
                  </div>
                  {m.options?.length && mode === 'customer' ? (
                    <div className="mt-1 flex flex-wrap gap-2" role="group" aria-label="Respostas rápidas">
                      {m.options.map((o) => (
                        <button
                          key={o.action}
                          type="button"
                          disabled={sending}
                          onClick={() => onQuickReply?.(o.action)}
                          title={o.hint}
                          className="rounded-full bg-surface px-3 py-1.5 text-left text-[13px] font-medium text-primary ring-1 ring-primary/40 transition hover:bg-primary-soft disabled:opacity-60"
                        >
                          {o.label}
                          <span className="block text-[11px] font-normal text-muted">{o.hint}</span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>

      <div className="border-t border-border/70 p-3">
        {closed ? (
          <div className="flex flex-col items-center gap-2 py-2 text-center">
            <p className="flex items-center justify-center gap-2 text-sm text-muted">
              {resolvedForCustomer ? <CheckCircle2 className="size-4 text-success" /> : <CircleDot className="size-4" />}
              {resolvedForCustomer ? 'Conversa resolvida. Precisa de mais alguma coisa?' : 'Conversa encerrada.'}
            </p>
            {onNewConversation ? (
              <Button size="sm" variant="outline" onClick={onNewConversation}>
                Abrir nova conversa
              </Button>
            ) : null}
          </div>
        ) : agentBlocked ? (
          <p className="py-2 text-center text-sm text-muted">A conversa ainda está com o assistente de triagem.</p>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
            className="space-y-2"
          >
            {mode === 'agent' ? (
              <div className="flex items-center gap-2 text-xs" role="radiogroup" aria-label="Tipo de mensagem">
                {[
                  { value: false, label: 'Responder ao cliente' },
                  { value: true, label: 'Nota interna' },
                ].map((o) => (
                  <button
                    key={String(o.value)}
                    type="button"
                    role="radio"
                    aria-checked={internal === o.value}
                    onClick={() => setInternal(o.value)}
                    className={cn(
                      'inline-flex h-7 items-center gap-1 rounded-full px-2.5 font-medium ring-1',
                      internal === o.value ? (o.value ? 'bg-warning-soft text-warning ring-warning/40' : 'bg-primary-soft text-primary ring-primary/30') : 'text-muted ring-border',
                    )}
                  >
                    {o.value ? <Lock className="size-3" /> : null}
                    {o.label}
                  </button>
                ))}
              </div>
            ) : null}
            <div className={cn('flex items-end gap-2 rounded-xl bg-surface-2 p-1.5 ring-1', internal && mode === 'agent' ? 'ring-warning/50' : 'ring-border/70')}>
              <label htmlFor={`msg-${conversation.id}`} className="sr-only">
                Mensagem
              </label>
              <textarea
                id={`msg-${conversation.id}`}
                ref={inputRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={onKeyDown}
                rows={Math.min(4, Math.max(1, draft.split('\n').length))}
                maxLength={4000}
                placeholder={mode === 'agent' ? (internal ? 'Anotação visível só para a equipe…' : 'Responder ao cliente…') : 'Escreva sua mensagem…'}
                className="max-h-32 min-h-9 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm outline-none placeholder:text-subtle"
              />
              <Button type="submit" size="icon-sm" aria-label="Enviar mensagem" disabled={!draft.trim() || sending} loading={sending}>
                <Send />
              </Button>
            </div>
            <p className="px-1 text-[11px] text-subtle">Enter envia · Shift+Enter quebra a linha</p>
          </form>
        )}
      </div>
    </div>
  );
}
