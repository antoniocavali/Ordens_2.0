'use client';

import type { LoginResponse } from '@ordens/contracts';
import { Button, Field, Input } from '@ordens/ui';
import { useQueryClient } from '@tanstack/react-query';
import { AlertCircle, KeyRound, ShieldCheck } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { ApiRequestError, post } from '@/lib/api';

export default function TwoFactorPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const [code, setCode] = useState('');
  const [recovery, setRecovery] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await post<LoginResponse>('/auth/2fa/verify', { code });
      qc.clear();
      router.replace(res.stage === 'PENDING_PASSWORD_CHANGE' ? '/login/nova-senha' : '/');
    } catch (err) {
      if (err instanceof ApiRequestError && err.status === 401 && err.code === 'UNAUTHENTICATED') router.replace('/login?expirada=1');
      setError(err instanceof ApiRequestError ? err.message : 'Não foi possível validar o código.');
      setLoading(false);
    }
  };

  return (
    <div className="space-y-8">
      <div className="space-y-4">
        <div className="grid size-12 place-items-center rounded-xl bg-primary-soft text-primary">
          <ShieldCheck className="size-6" />
        </div>
        <div className="space-y-1.5">
          <h1 className="text-[26px] font-semibold tracking-tight">Verificação em duas etapas</h1>
          <p className="text-sm text-muted">
            {recovery ? 'Informe um dos seus códigos de recuperação.' : 'Digite o código de 6 dígitos do seu aplicativo autenticador.'}
          </p>
        </div>
      </div>

      <form onSubmit={submit} className="space-y-4">
        {error ? (
          <div role="alert" className="flex items-start gap-2 rounded-md bg-danger-soft px-3 py-2.5 text-sm text-danger">
            <AlertCircle className="mt-0.5 size-4 shrink-0" />
            {error}
          </div>
        ) : null}
        <Field label={recovery ? 'Código de recuperação' : 'Código de verificação'}>
          {(a) => (
            <Input
              {...a}
              autoFocus
              value={code}
              onChange={(e) => setCode(recovery ? e.target.value : e.target.value.replace(/\D/g, '').slice(0, 6))}
              inputMode={recovery ? 'text' : 'numeric'}
              autoComplete="one-time-code"
              placeholder={recovery ? 'xxxx-xxxx-xx' : '000000'}
              className="h-12 text-center font-mono text-xl tracking-[0.4em]"
            />
          )}
        </Field>
        <Button type="submit" size="lg" className="w-full" loading={loading} disabled={recovery ? code.length < 10 : code.length !== 6}>
          Confirmar
        </Button>
        <button
          type="button"
          onClick={() => {
            setRecovery((r) => !r);
            setCode('');
          }}
          className="mx-auto flex items-center gap-1.5 text-[13px] font-medium text-primary hover:underline"
        >
          <KeyRound className="size-3.5" />
          {recovery ? 'Usar aplicativo autenticador' : 'Usar código de recuperação'}
        </button>
      </form>
    </div>
  );
}
