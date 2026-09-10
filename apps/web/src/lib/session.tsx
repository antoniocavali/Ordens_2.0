'use client';

import type { MeResponse, Permission } from '@ordens/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useTheme } from 'next-themes';
import { useCallback, useEffect } from 'react';
import { ApiRequestError, get, post } from './api';

export const ME_KEY = ['auth', 'me'] as const;

export function useMe() {
  return useQuery({
    queryKey: ME_KEY,
    queryFn: () => get<MeResponse>('/auth/me'),
    staleTime: 60_000,
    retry: (count, err) => !(err instanceof ApiRequestError && err.status === 401) && count < 2,
  });
}

export function useCan() {
  const { data } = useMe();
  return useCallback((p: Permission) => Boolean(data?.permissions.includes(p)), [data]);
}

/** Redireciona para login quando a sessão expira; aplica tema salvo do usuário. */
export function useSessionGuard() {
  const router = useRouter();
  const qc = useQueryClient();
  const me = useMe();
  const { setTheme } = useTheme();

  useEffect(() => {
    const onUnauth = () => {
      qc.clear();
      router.replace('/login?expirada=1');
    };
    window.addEventListener('ordens:unauthenticated', onUnauth);
    return () => window.removeEventListener('ordens:unauthenticated', onUnauth);
  }, [qc, router]);

  useEffect(() => {
    const err = me.error;
    if (err instanceof ApiRequestError) {
      if (err.code === 'TWO_FACTOR_REQUIRED') router.replace('/login/2fa');
      else if (err.status === 401) router.replace('/login');
    }
    if (me.data?.stage === 'PENDING_2FA_SETUP') router.replace('/conta/seguranca?obrigatorio=1');
  }, [me.error, me.data, router]);

  const theme = me.data?.user.theme;
  useEffect(() => {
    if (theme) setTheme(theme);
    // aplica apenas quando o valor salvo muda
  }, [theme, setTheme]);

  return me;
}

export async function logout() {
  await post('/auth/logout').catch(() => undefined);
  window.location.href = '/login';
}
