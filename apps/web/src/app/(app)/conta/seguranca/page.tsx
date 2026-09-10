'use client';

import type { LoginHistoryItem, SessionInfo, TwoFactorConfirmResponse, TwoFactorSetupResponse } from '@ordens/contracts';
import { Badge, Button, Card, Field, Input, Skeleton } from '@ordens/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Copy, KeyRound, LaptopMinimal, LogOut, ShieldCheck, Smartphone } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { ApiRequestError, del, get, post } from '@/lib/api';
import { formatDateTime, formatRelative } from '@/lib/format';
import { ME_KEY, useMe } from '@/lib/session';

const RESULT_LABEL: Record<string, { label: string; tone: 'success' | 'danger' | 'warning' | 'neutral' }> = {
  SUCCESS: { label: 'Senha correta', tone: 'success' },
  TWO_FACTOR_SUCCESS: { label: 'Login concluído (2FA)', tone: 'success' },
  INVALID_CREDENTIALS: { label: 'Senha incorreta', tone: 'danger' },
  TWO_FACTOR_FAILED: { label: 'Código 2FA inválido', tone: 'danger' },
  LOCKED: { label: 'Bloqueado', tone: 'warning' },
  INACTIVE: { label: 'Conta inativa', tone: 'neutral' },
};

function device(ua: string | null) {
  if (!ua) return 'Dispositivo desconhecido';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Navegador';
  const os = /Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'macOS' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Linux/.test(ua) ? 'Linux' : '';
  return `${browser}${os ? ` · ${os}` : ''}`;
}

function SecurityContent() {
  const params = useSearchParams();
  const required = params.get('obrigatorio') === '1';
  const { data: me } = useMe();

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-6 sm:px-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Segurança da conta</h1>
        <p className="mt-1 text-sm text-muted">{me?.user.email}</p>
      </div>
      {required ? (
        <div className="flex items-start gap-3 rounded-lg bg-warning-soft p-4 text-sm text-warning" role="alert">
          <AlertTriangle className="mt-0.5 size-5 shrink-0" />
          <div>
            <div className="font-semibold">Verificação em duas etapas obrigatória</div>
            <div>A política da sua organização exige 2FA. Ative abaixo para acessar a plataforma.</div>
          </div>
        </div>
      ) : null}
      <TwoFactorCard />
      {!required ? (
        <>
          <PasswordCard />
          <SessionsCard />
          <HistoryCard />
        </>
      ) : null}
    </div>
  );
}

function TwoFactorCard() {
  const qc = useQueryClient();
  const status = useQuery({ queryKey: ['2fa', 'status'], queryFn: () => get<{ enabled: boolean; remainingRecoveryCodes: number }>('/auth/2fa/status') });
  const [setup, setSetup] = useState<TwoFactorSetupResponse | null>(null);
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const start = useMutation({ mutationFn: () => post<TwoFactorSetupResponse>('/auth/2fa/setup'), onSuccess: setSetup });
  const confirm = useMutation({
    mutationFn: () => post<TwoFactorConfirmResponse & { stage: string }>('/auth/2fa/confirm', { code }),
    onSuccess: (r) => {
      setCodes(r.recoveryCodes);
      setSetup(null);
      setCode('');
      void qc.invalidateQueries({ queryKey: ['2fa'] });
      void qc.invalidateQueries({ queryKey: ME_KEY });
      toast.success('Verificação em duas etapas ativada');
    },
    onError: (err) => setError(err instanceof ApiRequestError ? err.message : 'Código inválido'),
  });

  return (
    <Card className="p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex gap-4">
          <span className="grid size-11 place-items-center rounded-lg bg-primary-soft text-primary">
            <ShieldCheck className="size-5" />
          </span>
          <div>
            <h2 className="font-semibold">Verificação em duas etapas (TOTP)</h2>
            <p className="text-sm text-muted">Google Authenticator, Microsoft Authenticator, Authy ou equivalente.</p>
          </div>
        </div>
        {status.data ? (
          status.data.enabled ? (
            <Badge tone="success">
              <CheckCircle2 /> Ativa · {status.data.remainingRecoveryCodes} códigos de recuperação
            </Badge>
          ) : (
            <Badge tone="warning">Desativada</Badge>
          )
        ) : (
          <Skeleton className="h-6 w-24" />
        )}
      </div>

      {codes ? (
        <div className="mt-5 space-y-3 rounded-lg bg-surface-2 p-4">
          <div className="text-sm font-semibold">Guarde seus códigos de recuperação</div>
          <p className="text-xs text-muted">Cada código funciona uma única vez. Eles não serão exibidos novamente.</p>
          <div className="grid grid-cols-2 gap-2 font-mono text-sm sm:grid-cols-5">
            {codes.map((c) => (
              <span key={c} className="rounded bg-surface px-2 py-1.5 text-center ring-1 ring-border">
                {c}
              </span>
            ))}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              void navigator.clipboard.writeText(codes.join('\n'));
              toast.success('Códigos copiados');
            }}
          >
            <Copy /> Copiar códigos
          </Button>
        </div>
      ) : null}

      {status.data && !status.data.enabled && !setup && !codes ? (
        <Button className="mt-5" onClick={() => start.mutate()} loading={start.isPending}>
          <Smartphone /> Ativar 2FA
        </Button>
      ) : null}

      {setup ? (
        <div className="mt-5 grid gap-6 sm:grid-cols-[200px_1fr]">
          <img src={setup.qrCodeDataUrl} alt="QR Code para configurar o aplicativo autenticador" className="size-[200px] rounded-lg bg-white p-2 ring-1 ring-border" />
          <form
            className="space-y-3"
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              setError(null);
              confirm.mutate();
            }}
          >
            <ol className="list-decimal space-y-1 pl-4 text-sm text-muted">
              <li>Escaneie o QR Code no aplicativo autenticador.</li>
              <li>Ou digite a chave manualmente:</li>
            </ol>
            <code className="block break-all rounded bg-surface-2 px-2 py-1.5 text-xs">{setup.secret}</code>
            <Field label="Código de 6 dígitos" error={error ?? undefined}>
              {(a) => <Input {...a} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" className="w-40 text-center font-mono text-lg tracking-[0.3em]" autoFocus />}
            </Field>
            <Button type="submit" loading={confirm.isPending} disabled={code.length !== 6}>
              Confirmar e ativar
            </Button>
          </form>
        </div>
      ) : null}
    </Card>
  );
}

function PasswordCard() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [code, setCode] = useState('');
  const { data: me } = useMe();
  const change = useMutation({
    mutationFn: () => post('/auth/password/change', { currentPassword: current, newPassword: next, code: code || undefined }),
    onSuccess: () => {
      toast.success('Senha alterada', { description: 'As demais sessões foram encerradas.' });
      setCurrent('');
      setNext('');
      setCode('');
    },
    onError: (err) => toast.error(err instanceof ApiRequestError ? (err.fieldErrors.newPassword?.[0] ?? err.message) : 'Erro ao alterar senha'),
  });
  return (
    <Card className="p-6">
      <div className="mb-4 flex items-center gap-3">
        <KeyRound className="size-5 text-muted" />
        <h2 className="font-semibold">Alterar senha</h2>
      </div>
      <form
        className="grid gap-4 sm:grid-cols-3"
        onSubmit={(e) => {
          e.preventDefault();
          change.mutate();
        }}
      >
        <Field label="Senha atual">{(a) => <Input {...a} type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />}</Field>
        <Field label="Nova senha" hint="Mínimo de 12 caracteres">
          {(a) => <Input {...a} type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />}
        </Field>
        {me?.user.twoFactorEnabled ? <Field label="Código 2FA">{(a) => <Input {...a} inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value)} />}</Field> : <div />}
        <div className="sm:col-span-3">
          <Button type="submit" variant="outline" loading={change.isPending} disabled={!current || next.length < 12}>
            Alterar senha
          </Button>
        </div>
      </form>
    </Card>
  );
}

function SessionsCard() {
  const qc = useQueryClient();
  const sessions = useQuery({ queryKey: ['sessions'], queryFn: () => get<SessionInfo[]>('/auth/sessions') });
  return (
    <Card className="p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <LaptopMinimal className="size-5 text-muted" />
          <h2 className="font-semibold">Sessões ativas</h2>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={async () => {
            await post('/auth/logout-all');
            window.location.href = '/login';
          }}
        >
          <LogOut /> Sair de todos os dispositivos
        </Button>
      </div>
      {sessions.isLoading ? (
        <Skeleton className="h-24" />
      ) : (
        <ul className="divide-y divide-border/70">
          {sessions.data?.map((s) => (
            <li key={s.id} className="flex items-center gap-3 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-sm font-medium">
                  {device(s.userAgent)} {s.current ? <Badge tone="primary" size="sm">Esta sessão</Badge> : null}
                </div>
                <div className="text-xs text-muted">
                  {s.ip ?? 'IP desconhecido'} · ativa {formatRelative(s.lastSeenAt)} · desde {formatDateTime(s.createdAt)}
                </div>
              </div>
              {!s.current ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={async () => {
                    await del(`/auth/sessions/${s.id}`);
                    void qc.invalidateQueries({ queryKey: ['sessions'] });
                    toast.success('Sessão encerrada');
                  }}
                >
                  Encerrar
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function HistoryCard() {
  const history = useQuery({ queryKey: ['login-history'], queryFn: () => get<LoginHistoryItem[]>('/auth/login-history') });
  return (
    <Card className="p-6">
      <h2 className="mb-4 font-semibold">Histórico de acesso</h2>
      {history.isLoading ? (
        <Skeleton className="h-24" />
      ) : (
        <ul className="divide-y divide-border/70 text-sm">
          {history.data?.slice(0, 15).map((h) => {
            const r = RESULT_LABEL[h.result] ?? { label: h.result, tone: 'neutral' as const };
            return (
              <li key={h.id} className="flex flex-wrap items-center gap-3 py-2.5">
                <Badge tone={r.tone} size="sm">
                  {r.label}
                </Badge>
                <span className="text-muted">{device(h.userAgent)}</span>
                <span className="text-subtle">{h.ip}</span>
                <span className="ml-auto text-xs text-subtle">{formatDateTime(h.createdAt)}</span>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

export default function SecurityPage() {
  return (
    <Suspense>
      <SecurityContent />
    </Suspense>
  );
}
