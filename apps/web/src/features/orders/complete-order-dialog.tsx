'use client';

import type { OrderCompletionCheck, OrderDetail } from '@ordens/contracts';
import { Button, Card, cn, Field, Skeleton, Textarea } from '@ordens/ui';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, FileWarning, Truck } from 'lucide-react';
import { useState } from 'react';
import { get } from '@/lib/api';
import { formatQty } from '@/lib/format';

/**
 * Conclusão da ordem pela Matriz (Q45): mostra a conferência (cargas em andamento, documentação fiscal
 * pendente e saldo) e só libera a confirmação com aceite explícito do que estiver pendente.
 */
export function CompleteOrderDialog({
  order,
  loading,
  onCancel,
  onConfirm,
}: {
  order: OrderDetail;
  loading: boolean;
  onCancel: () => void;
  onConfirm: (input: { reason: string | null; acceptPendingDocuments: boolean }) => void;
}) {
  const check = useQuery({
    queryKey: ['orders', order.id, 'completion-check'],
    queryFn: () => get<OrderCompletionCheck>(`/orders/${order.id}/completion-check`),
  });
  const [reason, setReason] = useState('');
  const [accepted, setAccepted] = useState(false);
  const c = check.data;

  const hasBalance = Boolean(c && Number(c.balance) > 0);
  const blocked = Boolean(c?.activeLoads.length);
  const needsAcceptance = Boolean(c?.pendingDocuments.length);
  const canConfirm = Boolean(c) && !blocked && (!needsAcceptance || accepted) && (!hasBalance || reason.trim().length >= 3);

  return (
    <div className="fixed inset-0 z-[70] grid place-items-center bg-[var(--overlay)] p-4" role="dialog" aria-modal="true" aria-label="Concluir ordem">
      <Card className="w-full max-w-xl overflow-hidden">
        <div className="border-b border-border/70 px-5 py-4">
          <h2 className="font-semibold">Concluir ordem {order.number}</h2>
          <p className="mt-1 text-sm text-muted">A ordem é encerrada para novas liberações, agendamentos e cargas. Fazenda e Comprador são avisados.</p>
        </div>

        <div className="max-h-[60vh] space-y-4 overflow-y-auto p-5">
          {!c ? (
            <Skeleton className="h-32 rounded-lg" />
          ) : (
            <>
              {blocked ? (
                <Alert tone="danger" icon={Truck} title={`${c.activeLoads.length} carga(s) em andamento`}>
                  Encerre ou cancele antes de concluir: <span className="font-mono">{c.activeLoads.join(', ')}</span>.
                </Alert>
              ) : null}

              {needsAcceptance ? (
                <Alert tone="warning" icon={FileWarning} title={`${c.pendingDocuments.length} carga(s) sem PDF e XML da Fazenda validados`}>
                  <ul className="mt-1 space-y-1">
                    {c.pendingDocuments.map((l) => (
                      <li key={l.id}>
                        <span className="font-mono">{l.number}</span> — {l.issues.join(' ')}
                      </li>
                    ))}
                  </ul>
                </Alert>
              ) : (
                <Alert tone="success" icon={CheckCircle2} title="Documentação fiscal completa">
                  {c.loadsTotal === 0 ? 'A ordem não tem cargas.' : `Todas as ${c.loadsTotal} carga(s) têm PDF e XML da Fazenda validados.`}
                </Alert>
              )}

              {hasBalance ? (
                <Alert tone="warning" icon={AlertTriangle} title={`Saldo a carregar: ${formatQty(c.balance, c.unit)}`}>
                  A ordem será concluída sem carregar todo o saldo. Informe o motivo.
                </Alert>
              ) : null}

              {needsAcceptance && !blocked ? (
                <label className="flex cursor-pointer items-start gap-2.5 rounded-lg px-3 py-2.5 ring-1 ring-warning/40 hover:bg-warning-soft/40">
                  <input type="checkbox" className="mt-0.5 size-4 accent-[var(--color-primary)]" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} />
                  <span className="text-sm">
                    <span className="block font-medium">Concluir mesmo sem a documentação fiscal completa</span>
                    <span className="block text-xs text-muted">O aceite fica registrado na auditoria com o seu usuário.</span>
                  </span>
                </label>
              ) : null}

              <Field label="Motivo" hint={hasBalance ? 'Obrigatório quando sobra saldo a carregar' : 'Opcional'}>
                {(a) => <Textarea {...a} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ex.: contrato encerrado com o volume carregado" />}
              </Field>
            </>
          )}
        </div>

        <div className={cn('flex justify-end gap-2 border-t border-border/70 px-5 py-4')}>
          <Button variant="ghost" onClick={onCancel}>
            Voltar
          </Button>
          <Button disabled={!canConfirm} loading={loading} onClick={() => onConfirm({ reason: reason.trim() || null, acceptPendingDocuments: accepted })}>
            Concluir ordem
          </Button>
        </div>
      </Card>
    </div>
  );
}

function Alert({
  tone,
  icon: Icon,
  title,
  children,
}: {
  tone: 'danger' | 'warning' | 'success';
  icon: typeof Truck;
  title: string;
  children: React.ReactNode;
}) {
  const cls = tone === 'danger' ? 'bg-danger-soft text-danger' : tone === 'warning' ? 'bg-warning-soft text-warning' : 'bg-success-soft text-success';
  return (
    <div className={cn('flex items-start gap-3 rounded-lg p-3 text-sm', cls)} role={tone === 'success' ? undefined : 'alert'}>
      <Icon className="mt-0.5 size-5 shrink-0" />
      <div className="min-w-0">
        <div className="font-semibold">{title}</div>
        <div className="text-text/80">{children}</div>
      </div>
    </div>
  );
}
