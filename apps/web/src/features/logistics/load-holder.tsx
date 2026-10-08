'use client';

import type { LoadStatus } from '@ordens/contracts';
import { cn } from '@ordens/ui';
import { CheckCircle2, Hourglass, Hand } from 'lucide-react';

type Party = 'FARM' | 'MATRIZ';

/** Com quem a carga está em cada etapa, e o que essa parte tem de fazer. */
const WAITING_ON: Partial<Record<LoadStatus, { party: Party; action: string }>> = {
  SCHEDULED: { party: 'FARM', action: 'informar a chegada e iniciar o carregamento' },
  CONFIRMED: { party: 'FARM', action: 'iniciar o carregamento' },
  AWAITING_LOADING: { party: 'FARM', action: 'iniciar o carregamento' },
  LOADING: { party: 'FARM', action: 'informar peso bruto e tara e confirmar o carregamento' },
  LOADED: { party: 'FARM', action: 'anexar o PDF e o XML da nota fiscal' },
  AWAITING_FARM_INVOICE: { party: 'FARM', action: 'anexar o PDF e o XML da nota fiscal e validar a documentação' },
  FARM_INVOICED: { party: 'MATRIZ', action: 'registrar o faturamento' },
  AWAITING_MATRIZ_INVOICE: { party: 'MATRIZ', action: 'registrar o faturamento' },
  MATRIZ_INVOICED: { party: 'MATRIZ', action: 'liberar a carga para trânsito' },
  IN_TRANSIT: { party: 'MATRIZ', action: 'concluir a carga' },
};

const PARTY_LABEL: Record<Party, string> = { FARM: 'Fazenda', MATRIZ: 'Matriz' };
/** Etapas em que a parte da Fazenda já terminou. */
const FARM_DONE: LoadStatus[] = ['FARM_INVOICED', 'AWAITING_MATRIZ_INVOICE', 'MATRIZ_INVOICED', 'IN_TRANSIT'];

export interface LoadHolder {
  /** A vez é de quem está olhando. */
  mine: boolean;
  /** Quem olha é a Fazenda e a parte dela já terminou. */
  done: boolean;
  title: string;
  text: string;
}

/**
 * Situação da carga do ponto de vista de quem olha: se a vez é dela, de outra parte, ou se a parte dela
 * já acabou. Sem isso, depois de validar a documentação fiscal a tela não dizia que a etapa da Fazenda
 * tinha terminado nem que a carga agora depende da Matriz.
 */
export function loadHolder(status: LoadStatus, scope: string | undefined): LoadHolder | null {
  if (status === 'COMPLETED') return { mine: false, done: true, title: 'Carga concluída', text: 'Faturada pela Matriz e liberada para trânsito.' };
  const waiting = WAITING_ON[status];
  if (!waiting) return null;
  const who = PARTY_LABEL[waiting.party];
  if (scope === waiting.party) return { mine: true, done: false, title: 'Sua vez', text: `Falta ${waiting.action}.` };
  if (scope === 'FARM' && FARM_DONE.includes(status)) {
    return { mine: false, done: true, title: 'Etapa da Fazenda concluída', text: `A carga agora está com a Matriz, que vai ${waiting.action}. Não há mais nada a fazer por aqui.` };
  }
  return { mine: false, done: false, title: `Com a ${who}`, text: `Aguardando a ${who} ${waiting.action}.` };
}

/** Faixa no topo da carga dizendo com quem ela está. */
export function LoadHolderBanner({ status, scope, loadNumber }: { status: LoadStatus; scope: string | undefined; loadNumber?: string }) {
  const h = loadHolder(status, scope);
  if (!h) return null;
  const Icon = h.done ? CheckCircle2 : h.mine ? Hand : Hourglass;
  return (
    <div
      role="status"
      className={cn(
        'flex items-start gap-3 rounded-lg px-4 py-3 text-sm ring-1',
        h.done ? 'bg-success-soft text-success ring-success/20' : h.mine ? 'bg-primary-soft text-primary ring-primary/20' : 'bg-surface-2 text-muted ring-border/70',
      )}
    >
      <Icon className="mt-0.5 size-4 shrink-0" />
      <div>
        <div className="font-semibold">
          {loadNumber ? <span className="mr-2 font-mono font-medium opacity-80">{loadNumber}</span> : null}
          {h.title}
        </div>
        <div className={cn(h.done || h.mine ? 'opacity-90' : '')}>{h.text}</div>
      </div>
    </div>
  );
}
