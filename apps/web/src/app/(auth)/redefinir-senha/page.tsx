'use client';

import { PASSWORD_MIN_LENGTH } from '@ordens/contracts';
import { Button, Field, Input } from '@ordens/ui';
import { CheckCircle2 } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState, type FormEvent } from 'react';
import { ApiRequestError, post } from '@/lib/api';

function ResetForm() {
  const params = useSearchParams();
  const token = params.get('token') ?? '';
  const invite = params.get('convite') === '1';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (password !== confirm) return setError('As senhas não conferem.');
    setLoading(true);
    setError(null);
    try {
      await post('/auth/password/reset', { token, password });
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiRequestError ? (err.fieldErrors.password?.[0] ?? err.message) : 'Tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  if (done) {
    return (
      <div className="space-y-4">
        <div className="grid size-12 place-items-center rounded-xl bg-success-soft text-success">
          <CheckCircle2 className="size-6" />
        </div>
        <h1 className="text-[26px] font-semibold tracking-tight">Senha definida</h1>
        <p className="text-sm text-muted">Por segurança, sessões anteriores foram encerradas.</p>
        <Button asChild size="lg" className="w-full">
          <Link href="/login">Entrar</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="space-y-1.5">
        <h1 className="text-[26px] font-semibold tracking-tight">{invite ? 'Bem-vindo! Defina sua senha' : 'Criar nova senha'}</h1>
        <p className="text-sm text-muted">Use pelo menos {PASSWORD_MIN_LENGTH} caracteres. Frases longas são mais seguras e fáceis de lembrar.</p>
      </div>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Nova senha" hint={`${password.length}/${PASSWORD_MIN_LENGTH}+ caracteres`}>
          {(a) => <Input {...a} type="password" autoComplete="new-password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />}
        </Field>
        <Field label="Confirmar senha" error={error ?? undefined}>
          {(a) => <Input {...a} type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />}
        </Field>
        <Button type="submit" size="lg" className="w-full" loading={loading} disabled={!token || password.length < PASSWORD_MIN_LENGTH}>
          Salvar senha
        </Button>
      </form>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetForm />
    </Suspense>
  );
}
