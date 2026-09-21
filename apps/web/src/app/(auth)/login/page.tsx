'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { loginSchema, type LoginResponse } from '@ordens/contracts';
import { Button, Field, Input } from '@ordens/ui';
import { useQueryClient } from '@tanstack/react-query';
import { AlertCircle, Eye, EyeOff, Fingerprint, LogIn } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { Logo } from '@/features/auth/auth-showcase';
import { ApiRequestError, post } from '@/lib/api';
import { browserSupportsWebAuthn, loginWithPasskey, passkeyCancelled } from '@/lib/passkeys';

type FormValues = z.input<typeof loginSchema>;

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const qc = useQueryClient();
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(params.get('expirada') ? 'Sua sessão expirou. Entre novamente.' : null);
  const form = useForm<FormValues>({ resolver: zodResolver(loginSchema), defaultValues: { email: '', password: '' } });

  const [passkeySupported, setPasskeySupported] = useState(false);
  const [passkeyBusy, setPasskeyBusy] = useState(false);
  useEffect(() => setPasskeySupported(browserSupportsWebAuthn()), []);

  const proceed = (res: LoginResponse) => {
    qc.clear();
    if (res.stage === 'PENDING_2FA') router.replace('/login/2fa');
    else if (res.stage === 'PENDING_PASSWORD_CHANGE') router.replace('/login/nova-senha');
    else if (res.stage === 'PENDING_2FA_SETUP') router.replace('/conta/seguranca?obrigatorio=1');
    else router.replace(params.get('next') ?? '/');
  };

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      proceed(await post<LoginResponse>('/auth/login', values));
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Não foi possível entrar agora.');
    }
  });

  const onPasskey = async () => {
    setError(null);
    setPasskeyBusy(true);
    try {
      proceed(await loginWithPasskey());
    } catch (err) {
      if (!passkeyCancelled(err)) setError(err instanceof ApiRequestError ? err.message : 'Não foi possível entrar com a passkey.');
    } finally {
      setPasskeyBusy(false);
    }
  };

  return (
    <div className="space-y-8">
      <div className="space-y-5">
        <Logo className="size-10 lg:hidden" />
        <div className="space-y-1.5">
          <h1 className="text-[26px] font-semibold tracking-tight">Entrar na plataforma</h1>
          <p className="text-sm text-muted">Acesse a central de ordens de carregamento.</p>
        </div>
      </div>

      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        {error ? (
          <div role="alert" className="flex items-start gap-2 rounded-md bg-danger-soft px-3 py-2.5 text-sm text-danger">
            <AlertCircle className="mt-0.5 size-4 shrink-0" />
            {error}
          </div>
        ) : null}

        <Field label="E-mail" error={form.formState.errors.email?.message}>
          {(a) => <Input {...a} type="email" autoComplete="username" autoFocus placeholder="voce@empresa.com.br" {...form.register('email')} />}
        </Field>

        <Field label="Senha" error={form.formState.errors.password?.message}>
          {(a) => (
            <div className="relative">
              <Input {...a} type={showPassword ? 'text' : 'password'} autoComplete="current-password" className="pr-10" {...form.register('password')} />
              <button
                type="button"
                onClick={() => setShowPassword((s) => !s)}
                className="absolute inset-y-0 right-0 grid w-10 place-items-center text-subtle hover:text-text"
                aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
              >
                {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
          )}
        </Field>

        <div className="flex justify-end">
          <Link href="/recuperar-senha" className="text-[13px] font-medium text-primary hover:underline">
            Esqueci minha senha
          </Link>
        </div>

        <Button type="submit" size="lg" className="w-full" loading={form.formState.isSubmitting}>
          {!form.formState.isSubmitting ? <LogIn /> : null}
          Entrar
        </Button>

        {passkeySupported ? (
          <>
            <div className="flex items-center gap-3 text-xs text-subtle" aria-hidden>
              <span className="h-px flex-1 bg-border" />
              ou
              <span className="h-px flex-1 bg-border" />
            </div>
            <Button type="button" variant="outline" size="lg" className="w-full" onClick={() => void onPasskey()} loading={passkeyBusy}>
              {!passkeyBusy ? <Fingerprint /> : null}
              Entrar com passkey
            </Button>
          </>
        ) : null}
      </form>

      <p className="text-center text-xs text-subtle">Protegido por passkeys, verificação em duas etapas e bloqueio progressivo.</p>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
