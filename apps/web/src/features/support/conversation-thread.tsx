'use client';

import { SUPPORT_ATTACHMENTS_PER_MESSAGE, SUPPORT_STATUS_LABELS, type SupportBotAction, type SupportConversationDetail, type SupportStatus } from '@ordens/contracts';
import { Badge, Button, cn } from '@ordens/ui';
import { Bot, CheckCircle2, CircleDot, Clock, Headphones, ImagePlus, Lock, MessageCircleQuestion, MonitorUp, Send, UserRound, X, XCircle, type LucideIcon } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react';
import { toast } from 'sonner';
import { ApiRequestError } from '@/lib/api';
import { formatDateTime, formatTime } from '@/lib/format';
import { MessageAttachments } from './message-attachments';
import { captureScreen, CaptureCancelled, captureSupported } from './screen-capture';
import { uploadSupportAttachment } from './support-api';

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

/** Imagem em prévia no compositor: ainda sem id enquanto sobe ao storage. */
interface PendingAttachment {
  key: string;
  name: string;
  preview: string;
  id?: string;
  error?: boolean;
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
  onSend: (body: string, internal: boolean, attachmentIds: string[]) => Promise<unknown> | void;
  onQuickReply?: (action: SupportBotAction) => void;
  /** Chat do cliente: conversa resolvida não reabre (Q29), oferece abrir outra. */
  onNewConversation?: () => void;
}) {
  const [draft, setDraft] = useState('');
  const [internal, setInternal] = useState(false);
  const [pending, setPending] = useState<PendingAttachment[]>([]);
  const [capturing, setCapturing] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
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

  const ready = pending.filter((a) => a.id);
  const uploading = pending.some((a) => !a.id && !a.error);

  const submit = async () => {
    const body = draft.trim();
    if ((!body && !ready.length) || sending || uploading) return;
    setDraft('');
    const ids = ready.map((a) => a.id!);
    setPending([]);
    try {
      await onSend(body, mode === 'agent' && internal, ids);
    } catch {
      setDraft(body);
      setPending(ready);
    }
  };

  /** Captura ou arquivo escolhido: sobe na hora e fica em prévia até a mensagem ser enviada. */
  const attach = async (file: File) => {
    if (pending.length >= SUPPORT_ATTACHMENTS_PER_MESSAGE) {
      toast.error('No máximo 3 imagens por mensagem.');
      return;
    }
    const key = `${file.name}-${Date.now()}`;
    const preview = URL.createObjectURL(file);
    setPending((list) => [...list, { key, name: file.name, preview }]);
    try {
      const sent = await uploadSupportAttachment(conversation.id, file);
      setPending((list) => list.map((a) => (a.key === key ? { ...a, id: sent.id } : a)));
    } catch (err) {
      setPending((list) => list.map((a) => (a.key === key ? { ...a, error: true } : a)));
      toast.error(err instanceof ApiRequestError ? err.message : 'Não foi possível enviar a imagem.');
    }
  };

  const capture = async () => {
    setCapturing(true);
    try {
      await attach(await captureScreen());
    } catch (err) {
      // Cancelar ou não ter suporte não é erro: oferece anexar/colar imagem.
      if (err instanceof CaptureCancelled) {
        if (!captureSupported()) toast.info('Este navegador não captura tela. Anexe ou cole uma imagem.');
      } else {
        toast.error(err instanceof Error ? err.message : 'Não foi possível capturar a tela.');
      }
    } finally {
      setCapturing(false);
    }
  };

  const removePending = (key: string) => {
    setPending((list) => {
      const target = list.find((a) => a.key === key);
      if (target) URL.revokeObjectURL(target.preview);
      return list.filter((a) => a.key !== key);
    });
  };

  /** Colar imagem da área de transferência (Print Screen no Windows cai aqui). */
  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const file = Array.from(e.clipboardData?.files ?? []).find((f) => f.type.startsWith('image/'));
    if (file) {
      e.preventDefault();
      void attach(file);
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
                  <MessageAttachments attachments={m.attachments} />
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
                onPaste={onPaste}
                rows={Math.min(4, Math.max(1, draft.split('\n').length))}
                maxLength={4000}
                placeholder={mode === 'agent' ? (internal ? 'Anotação visível só para a equipe…' : 'Responder ao cliente…') : 'Escreva sua mensagem…'}
                className="max-h-32 min-h-9 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm outline-none placeholder:text-subtle"
              />
              <Button type="button" size="icon-sm" variant="ghost" aria-label="Capturar tela" title="Capturar tela" onClick={() => void capture()} loading={capturing}>
                <MonitorUp />
              </Button>
              <Button type="button" size="icon-sm" variant="ghost" aria-label="Anexar imagem" title="Anexar imagem" onClick={() => fileInput.current?.click()}>
                <ImagePlus />
              </Button>
              <input
                ref={fileInput}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                hidden
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  if (file) void attach(file);
                }}
              />
              <Button type="submit" size="icon-sm" aria-label="Enviar mensagem" disabled={(!draft.trim() && !ready.length) || sending || uploading} loading={sending}>
                <Send />
              </Button>
            </div>
            {pending.length ? (
              <>
                <ul className="flex flex-wrap gap-2 px-1">
                  {pending.map((a) => (
                    <li key={a.key} className={cn('relative overflow-hidden rounded-lg ring-1', a.error ? 'ring-danger/60' : 'ring-border')}>
                      {/* Prévia local (blob), não vai ao servidor: next/image não se aplica. */}
                      <img src={a.preview} alt={a.name} className="size-16 object-cover" />
                      {!a.id && !a.error ? (
                        <span className="absolute inset-0 grid place-items-center bg-surface/70 text-[10px] text-muted">enviando…</span>
                      ) : null}
                      <button
                        type="button"
                        aria-label={`Remover ${a.name}`}
                        onClick={() => removePending(a.key)}
                        className="absolute right-0 top-0 grid size-5 place-items-center rounded-bl-md bg-surface/90 text-muted hover:text-danger"
                      >
                        <X className="size-3" />
                      </button>
                    </li>
                  ))}
                </ul>
                <p className="px-1 text-[11px] text-warning">Revise a imagem antes de enviar. Não compartilhe senhas, tokens ou dados pessoais desnecessários.</p>
              </>
            ) : null}
            <p className="px-1 text-[11px] text-subtle">Enter envia · Shift+Enter quebra a linha · Print Screen pode ser colado aqui</p>
          </form>
        )}
      </div>
    </div>
  );
}
