'use client';

import type { LoginResponse } from '@ordens/contracts';
import { Button, Field, Input } from '@ordens/ui';
import { useQueryClient } from '@tanstack/react-query';
import { AlertCircle, KeyRound, LogOut } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { ApiRequestError, post } from '@/lib/api';
import { logout } from '@/lib/session';

/** Troca obrigatória após senha provisória definida por um administrador. */
export default function NewPasswordPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const mismatch = confirm.length > 0 && next !== confirm;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setFieldError(null);
    if (next !== confirm) return setFieldError('As senhas não conferem');
    setLoading(true);
    try {
      const res = await post<LoginResponse>('/auth/password/change', { currentPassword: current, newPassword: next });
      qc.clear();
      router.replace(res.stage === 'PENDING_2FA_SETUP' ? '/conta/seguranca?obrigatorio=1' : '/');
    } catch (err) {
      if (err instanceof ApiRequestError && err.status === 401) return router.replace('/login?expirada=1');
      if (err instanceof ApiRequestError) {
        setFieldError(err.fieldErrors.newPassword?.[0] ?? null);
        setError(err.fieldErrors.newPassword?.[0] ? null : err.message);
      } else setError('Não foi possível alterar a senha.');
      setLoading(false);
    }
  };

  return (
    <div className="space-y-8">
      <div className="space-y-4">
        <div className="grid size-12 place-items-center rounded-xl bg-primary-soft text-primary">
          <KeyRound className="size-6" />
        </div>
        <div className="space-y-1.5">
          <h1 className="text-[26px] font-semibold tracking-tight">Crie sua nova senha</h1>
          <p className="text-sm text-muted">Um administrador definiu uma senha provisória para você. Para continuar, escolha uma senha pessoal.</p>
        </div>
      </div>

      <form onSubmit={submit} className="space-y-4" noValidate>
        {error ? (
          <div role="alert" className="flex items-start gap-2 rounded-md bg-danger-soft px-3 py-2.5 text-sm text-danger">
            <AlertCircle className="mt-0.5 size-4 shrink-0" />
            {error}
          </div>
        ) : null}
        <Field label="Senha provisória">
          {(a) => <Input {...a} type="password" autoComplete="current-password" autoFocus value={current} onChange={(e) => setCurrent(e.target.value)} />}
        </Field>
        <Field label="Nova senha" hint="Mínimo de 12 caracteres" error={fieldError ?? undefined}>
          {(a) => <Input {...a} type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />}
        </Field>
        <Field label="Confirmar nova senha" error={mismatch ? 'As senhas não conferem' : undefined}>
          {(a) => <Input {...a} type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />}
        </Field>
        <Button type="submit" size="lg" className="w-full" loading={loading} disabled={!current || next.length < 12 || next !== confirm}>
          Salvar nova senha
        </Button>
        <button type="button" onClick={() => void logout()} className="mx-auto flex items-center gap-1.5 text-[13px] font-medium text-muted hover:text-text">
          <LogOut className="size-3.5" /> Sair
        </button>
      </form>
    </div>
  );
}
