'use client';

import { Button, Field, Input } from '@ordens/ui';
import { ArrowLeft, MailCheck } from 'lucide-react';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { ApiRequestError, post } from '@/lib/api';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await post('/auth/password/forgot', { email });
      setSent(true);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Tente novamente em instantes.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-8">
      <Link href="/login" className="inline-flex items-center gap-1.5 text-[13px] font-medium text-muted hover:text-text">
        <ArrowLeft className="size-4" /> Voltar ao login
      </Link>
      {sent ? (
        <div className="space-y-4">
          <div className="grid size-12 place-items-center rounded-xl bg-success-soft text-success">
            <MailCheck className="size-6" />
          </div>
          <h1 className="text-[26px] font-semibold tracking-tight">Verifique seu e-mail</h1>
          <p className="text-sm text-muted">
            Se <strong className="text-text">{email}</strong> estiver cadastrado, enviamos um link para redefinir a senha. O link expira em 30
            minutos.
          </p>
        </div>
      ) : (
        <>
          <div className="space-y-1.5">
            <h1 className="text-[26px] font-semibold tracking-tight">Recuperar senha</h1>
            <p className="text-sm text-muted">Enviaremos um link seguro para você criar uma nova senha.</p>
          </div>
          <form onSubmit={submit} className="space-y-4">
            <Field label="E-mail" error={error ?? undefined}>
              {(a) => <Input {...a} type="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />}
            </Field>
            <Button type="submit" size="lg" className="w-full" loading={loading}>
              Enviar link
            </Button>
          </form>
        </>
      )}
    </div>
  );
}
