'use client';

import { CRITICAL_2FA_ROLES, ROLES, type SecurityPolicyDto, type UpdateSecurityPolicyInput } from '@ordens/contracts';
import { Button, Card, cn, EmptyState, Input, Skeleton } from '@ordens/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlarmClock, KeyRound, ShieldCheck, ShieldOff, TriangleAlert } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { ApiRequestError, get, put } from '@/lib/api';
import { useCan, useMe } from '@/lib/session';

const SCOPE_LABELS: Record<string, string> = { MATRIZ: 'Matriz', FARM: 'Fazenda', BUYER: 'Comprador', CARRIER: 'Transportadora' };
const TENANT_ROLES = Object.entries(ROLES).filter(([, r]) => r.scope !== 'PLATFORM');

function Switch({ label, checked, onChange, disabled }: { label: string; checked: boolean; onChange: (next: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 disabled:cursor-not-allowed disabled:opacity-50',
        checked ? 'bg-primary' : 'bg-surface-3 ring-1 ring-border',
      )}
    >
      <span className={cn('inline-block size-4 rounded-full bg-white shadow transition-transform', checked ? 'translate-x-6' : 'translate-x-1')} />
    </button>
  );
}

/** Política de segurança do tenant: exigência de 2FA (todos ou por papel) e prazo de visualização das ordens. */
export function SecurityPolicyPage() {
  const can = useCan();
  const { data: me } = useMe();
  const allowed = can('security.policy.manage');
  const qc = useQueryClient();
  const policy = useQuery({ queryKey: ['settings', 'security'], queryFn: () => get<SecurityPolicyDto>('/settings/security'), enabled: allowed });
  const [draft, setDraft] = useState<UpdateSecurityPolicyInput | null>(null);
  const [slaText, setSlaText] = useState('');

  useEffect(() => {
    if (policy.data) {
      setDraft({ require2fa: policy.data.require2fa, require2faRoles: policy.data.require2faRoles, viewSlaHours: policy.data.viewSlaHours });
      setSlaText(String(policy.data.viewSlaHours));
    }
  }, [policy.data]);

  const save = useMutation({
    mutationFn: (body: UpdateSecurityPolicyInput) => put<SecurityPolicyDto>('/settings/security', body),
    onSuccess: (d) => {
      qc.setQueryData(['settings', 'security'], d);
      void qc.invalidateQueries({ queryKey: ['orders'] });
      toast.success('Política de segurança salva', { description: 'Vale a partir do próximo acesso de cada pessoa.' });
    },
    onError: (err) => toast.error(err instanceof ApiRequestError ? err.message : 'Não foi possível salvar.'),
  });

  // Quem passaria a precisar configurar 2FA no próximo acesso com o rascunho atual.
  const impacted = useMemo(() => {
    if (!draft || !policy.data) return [];
    return policy.data.coverage.without2fa.filter((m) => draft.require2fa || m.roles.some((r) => draft.require2faRoles.includes(r)));
  }, [draft, policy.data]);

  if (me && !allowed) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16">
        <EmptyState icon={<ShieldOff />} title="Sem acesso à política de segurança" description="Somente administradores da Matriz alteram a política de segurança." />
      </div>
    );
  }

  const data = policy.data;
  const sla = Number(slaText);
  const slaValid = Number.isInteger(sla) && sla >= 1 && sla <= 720;
  const dirty =
    Boolean(draft && data) &&
    (draft!.require2fa !== data!.require2fa || draft!.viewSlaHours !== data!.viewSlaHours || [...draft!.require2faRoles].sort().join() !== [...data!.require2faRoles].sort().join());
  const coverageOf = (role: string) => data?.coverage.roles.find((r) => r.role === role);
  const toggleRole = (role: string, on: boolean) =>
    setDraft((d) => (d ? { ...d, require2faRoles: on ? [...new Set([...d.require2faRoles, role])] : d.require2faRoles.filter((r) => r !== role) } : d));

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5 px-4 py-6 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <span className="grid size-11 place-items-center rounded-xl bg-primary-soft text-primary">
            <ShieldCheck className="size-5" />
          </span>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Segurança</h1>
            <p className="text-sm text-muted">Política da empresa para verificação em duas etapas e prazos de visualização. Toda alteração fica na auditoria.</p>
          </div>
        </div>
        <Button
          onClick={() => draft && save.mutate({ ...draft, viewSlaHours: sla })}
          loading={save.isPending}
          disabled={!dirty || !slaValid}
        >
          Salvar política
        </Button>
      </div>

      {!data || !draft ? (
        <div className="space-y-4">
          <Skeleton className="h-40" />
          <Skeleton className="h-64" />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-lg bg-surface p-3 shadow-sm ring-1 ring-border/60">
              <div className="text-xs font-medium text-muted">Acessos ativos</div>
              <div className="mt-1 text-2xl font-semibold tabular">{data.coverage.totalMembers}</div>
            </div>
            <div className="rounded-lg bg-surface p-3 shadow-sm ring-1 ring-border/60">
              <div className="text-xs font-medium text-muted">Com 2FA configurado</div>
              <div className="mt-1 text-2xl font-semibold text-success tabular">
                {data.coverage.with2fa}
                <span className="ml-1.5 text-sm font-normal text-muted">
                  ({data.coverage.totalMembers ? Math.round((data.coverage.with2fa / data.coverage.totalMembers) * 100) : 0}%)
                </span>
              </div>
            </div>
            <div className="rounded-lg bg-surface p-3 shadow-sm ring-1 ring-border/60">
              <div className="text-xs font-medium text-muted">Sem 2FA</div>
              <div className={cn('mt-1 text-2xl font-semibold tabular', data.coverage.without2fa.length && 'text-warning')}>{data.coverage.totalMembers - data.coverage.with2fa}</div>
            </div>
          </div>

          <Card className="overflow-hidden">
            <div className="flex items-start justify-between gap-4 border-b border-border/70 p-5">
              <div className="flex gap-3">
                <KeyRound className="mt-0.5 size-5 shrink-0 text-primary" />
                <div>
                  <h2 className="font-semibold">Exigir verificação em duas etapas de todos</h2>
                  <p className="text-sm text-muted">Quem ainda não configurou precisa fazer isso no próximo acesso, antes de usar a plataforma.</p>
                </div>
              </div>
              <Switch label="Exigir 2FA de todos os usuários" checked={draft.require2fa} onChange={(v) => setDraft({ ...draft, require2fa: v })} />
            </div>

            <div className={cn('p-5', draft.require2fa && 'pointer-events-none opacity-50')} aria-disabled={draft.require2fa}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold">Ou exigir apenas de alguns papéis</h3>
                  <p className="mb-3 text-xs text-muted">{draft.require2fa ? 'Já exigido de todos.' : 'Marque os papéis que devem usar 2FA.'}</p>
                </div>
                {!draft.require2fa ? (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={CRITICAL_2FA_ROLES.every((r) => draft.require2faRoles.includes(r))}
                    onClick={() => setDraft({ ...draft, require2faRoles: [...new Set([...draft.require2faRoles, ...CRITICAL_2FA_ROLES])] })}
                    title="Papéis que publicam ordens ou gerenciam usuários"
                  >
                    Aplicar recomendação
                  </Button>
                ) : null}
              </div>
              <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
                {TENANT_ROLES.map(([code, r]) => {
                  const cov = coverageOf(code);
                  const checked = draft.require2fa || draft.require2faRoles.includes(code);
                  return (
                    <label key={code} className="flex items-center gap-3 rounded-md px-2 py-2 hover:bg-surface-2">
                      <input
                        type="checkbox"
                        className="size-4 accent-[var(--color-primary)]"
                        checked={checked}
                        disabled={draft.require2fa}
                        onChange={(e) => toggleRole(code, e.target.checked)}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{r.name}</span>
                        <span className="block text-xs text-subtle">{SCOPE_LABELS[r.scope] ?? r.scope}</span>
                      </span>
                      <span className={cn('text-xs tabular', cov && cov.total > cov.with2fa ? 'text-warning' : 'text-muted')}>
                        {cov ? `${cov.with2fa} de ${cov.total} com 2FA` : 'sem acessos'}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>

            {impacted.length ? (
              <div className="border-t border-border/70 bg-warning-soft/40 p-5">
                <div className="flex items-center gap-2 text-sm font-semibold text-warning">
                  <TriangleAlert className="size-4" /> {impacted.length} {impacted.length === 1 ? 'pessoa precisará' : 'pessoas precisarão'} configurar 2FA no próximo acesso
                </div>
                <ul className="mt-2 max-h-48 space-y-1 overflow-auto text-sm">
                  {impacted.map((m) => (
                    <li key={m.membershipId} className="flex flex-wrap gap-x-2">
                      <span className="font-medium">{m.name}</span>
                      <span className="text-muted">{m.email}</span>
                      <span className="text-xs text-subtle">· {m.organization}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </Card>

          <Card className="p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex gap-3">
                <AlarmClock className="mt-0.5 size-5 shrink-0 text-primary" />
                <div>
                  <h2 className="font-semibold">Prazo para visualizar ordens</h2>
                  <p className="text-sm text-muted">Depois desse prazo sem Fazenda ou Comprador abrir a versão atual, o farol fica vermelho e a ordem entra em "Precisa da sua atenção".</p>
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <Input
                  type="number"
                  min={1}
                  max={720}
                  aria-label="Prazo de visualização em horas"
                  value={slaText}
                  onChange={(e) => {
                    setSlaText(e.target.value);
                    const n = Number(e.target.value);
                    if (Number.isInteger(n)) setDraft({ ...draft, viewSlaHours: n });
                  }}
                  className={cn('w-24 text-right tabular', !slaValid && 'ring-danger')}
                />
                horas
              </label>
            </div>
            {!slaValid ? <p className="mt-2 text-xs text-danger">Informe um prazo entre 1 e 720 horas.</p> : null}
          </Card>
        </>
      )}
    </div>
  );
}
