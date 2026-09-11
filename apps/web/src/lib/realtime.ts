'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useMe } from './session';

/** Janela para agrupar invalidações em rajada (várias cargas mudando de status de uma vez). */
const FLUSH_MS = 400;

/**
 * Assina o stream SSE da API e invalida as consultas indicadas.
 * O stream só traz chaves de consulta; os dados são buscados de novo pela API (permissão + RLS).
 * Se o stream cair, o EventSource reconecta sozinho e as consultas seguem com polling próprio.
 */
export function useRealtime() {
  const qc = useQueryClient();
  const { data: me } = useMe();
  const membershipKey = me?.activeMembership ? `${me.activeMembership.scope}|${me.activeMembership.organization.name}` : null;

  useEffect(() => {
    if (!membershipKey || typeof EventSource === 'undefined') return;
    const source = new EventSource('/realtime/stream', { withCredentials: true });
    const pending = new Map<string, string[]>();
    let timer: ReturnType<typeof setTimeout> | null = null;

    const flush = () => {
      timer = null;
      for (const key of pending.values()) void qc.invalidateQueries({ queryKey: key });
      pending.clear();
    };
    const onKeys = (event: MessageEvent<string>) => {
      try {
        const { keys } = JSON.parse(event.data) as { keys: string[][] };
        for (const key of keys) pending.set(key.join('|'), key);
        timer ??= setTimeout(flush, FLUSH_MS);
      } catch {
        // mensagem malformada: ignorada
      }
    };

    source.addEventListener('invalidate', onKeys);
    source.addEventListener('notification', onKeys);
    return () => {
      source.close();
      if (timer) clearTimeout(timer);
    };
  }, [membershipKey, qc]);
}
