'use client';

import type { WorkflowSettingsDto } from '@ordens/contracts';
import { Button, Card, cn, EmptyState, Input, Skeleton } from '@ordens/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Send, Settings2, ShieldOff, UsersRound } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { ApiRequestError, get, put } from '@/lib/api';
import { parseDecimalInput, toDecimalInput } from '@/lib/format';
import { useCan, useMe } from '@/lib/session';

function Switch({ label, checked, onChange }: { label: string; checked: boolean; onChange: (next: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
        checked ? 'bg-primary' : 'bg-surface-3 ring-1 ring-border',
      )}
    >
      <span className={cn('inline-block size-4 rounded-full bg-white shadow transition-transform', checked ? 'translate-x-6' : 'translate-x-1')} />
    </button>
  );
}

/** Fluxo de publicação das ordens (Q40): solicitação de publicação e dupla checagem. */
export function WorkflowPage() {
  const can = useCan();
  const { data: me } = useMe();
  const allowed = can('settings.manage');
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: ['settings', 'workflow'], queryFn: () => get<WorkflowSettingsDto>('/settings/workflow'), enabled: allowed });
  const [fourEyes, setFourEyes] = useState(false);
  const [minText, setMinText] = useState('');

  useEffect(() => {
    if (settings.data) {
      setFourEyes(settings.data.publishFourEyes);
      setMinText(toDecimalInput(settings.data.publishFourEyesMinT));
    }
  }, [settings.data]);

  const save = useMutation({
    mutationFn: (body: WorkflowSettingsDto) => put<WorkflowSettingsDto>('/settings/workflow', body),
    onSuccess: (d) => {
      qc.setQueryData(['settings', 'workflow'], d);
      void qc.invalidateQueries({ queryKey: ['orders'] });
      toast.success('Fluxo de publicação salvo');
    },
    onError: (err) => toast.error(err instanceof ApiRequestError ? (err.fieldErrors.publishFourEyesMinT?.[0] ?? err.message) : 'Não foi possível salvar.'),
  });

  if (me && !allowed) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16">
        <EmptyState icon={<ShieldOff />} title="Sem acesso ao workflow" description="Somente administradores da Matriz alteram o fluxo de publicação." />
      </div>
    );
  }

  const min = minText.trim() ? parseDecimalInput(minText) : null;
  const minValid = min === null || (min !== '' && Number(min) > 0);
  const data = settings.data;
  const dirty = Boolean(data) && (fourEyes !== data!.publishFourEyes || (fourEyes && (min ?? null) !== (data!.publishFourEyesMinT ? parseDecimalInput(toDecimalInput(data!.publishFourEyesMinT)) : null)));

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5 px-4 py-6 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <span className="grid size-11 place-items-center rounded-xl bg-primary-soft text-primary">
            <Settings2 className="size-5" />
          </span>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Workflow</h1>
            <p className="text-sm text-muted">Como as ordens de carregamento chegam à publicação. Alterações ficam na auditoria.</p>
          </div>
        </div>
        <Button onClick={() => save.mutate({ publishFourEyes: fourEyes, publishFourEyesMinT: fourEyes ? min : null })} loading={save.isPending} disabled={!dirty || !minValid}>
          Salvar workflow
        </Button>
      </div>

      {!data ? (
        <Skeleton className="h-72" />
      ) : (
        <>
          <Card className="p-5">
            <div className="flex gap-3">
              <Send className="mt-0.5 size-5 shrink-0 text-primary" />
              <div className="space-y-1">
                <h2 className="font-semibold">Solicitação de publicação</h2>
                <p className="text-sm text-muted">
                  Sempre ativa. Quem monta a ordem sem permissão para publicar (por exemplo, o Operador) usa <strong>Solicitar publicação</strong>: o rascunho é conferido e quem pode
                  publicar recebe um aviso. A publicação continua exigindo a permissão <em>Publicar ordens</em>.
                </p>
              </div>
            </div>
          </Card>

          <Card className="overflow-hidden">
            <div className="flex items-start justify-between gap-4 p-5">
              <div className="flex gap-3">
                <UsersRound className="mt-0.5 size-5 shrink-0 text-primary" />
                <div>
                  <h2 className="font-semibold">Dupla checagem na publicação</h2>
                  <p className="text-sm text-muted">Quem fez a última alteração no rascunho não pode publicá-lo: outra pessoa com permissão revisa e publica.</p>
                </div>
              </div>
              <Switch label="Exigir dupla checagem na publicação" checked={fourEyes} onChange={setFourEyes} />
            </div>
            <div className={cn('border-t border-border/70 p-5', !fourEyes && 'pointer-events-none opacity-50')} aria-disabled={!fourEyes}>
              <label className="flex flex-wrap items-center gap-2 text-sm">
                Aplicar só a ordens com
                <Input
                  aria-label="Quantidade mínima para dupla checagem (t)"
                  inputMode="decimal"
                  placeholder="qualquer"
                  value={minText}
                  disabled={!fourEyes}
                  onChange={(e) => setMinText(e.target.value)}
                  className={cn('w-32 text-right tabular', !minValid && 'ring-danger')}
                />
                toneladas ou mais
              </label>
              <p className={cn('mt-1.5 text-xs', minValid ? 'text-subtle' : 'text-danger')}>
                {minValid ? 'Deixe em branco para exigir em todas as ordens. A quantidade é convertida para toneladas pela unidade da ordem.' : 'Informe uma quantidade maior que zero.'}
              </p>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
