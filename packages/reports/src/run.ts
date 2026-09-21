import { REPORT_INFO, REPORT_MAX_DAYS, type ReportKind, type ReportQuery, type ReportResult } from '@ordens/contracts';
import { Prisma, type Tx } from '@ordens/db';
import { REPORTS, TZ } from './definitions.js';

const DAY = 86_400_000;
const todayInTz = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
const shift = (day: string, delta: number) => new Date(new Date(`${day}T00:00:00Z`).getTime() + delta * DAY).toISOString().slice(0, 10);

/** Falha de regra ao montar o relatório; a API traduz para a resposta HTTP. */
export class ReportError extends Error {
  constructor(
    readonly reason: 'forbidden' | 'invalid_period',
    message: string,
    readonly field?: 'from',
  ) {
    super(message);
  }
}

/** Período padrão: últimos 30 dias até hoje (fuso operacional); no máximo {@link REPORT_MAX_DAYS} dias. */
export function reportPeriod(q: Pick<ReportQuery, 'from' | 'to'>): { from: string; to: string } {
  const to = q.to ?? todayInTz();
  const from = q.from ?? shift(to, -29);
  const days = (new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / DAY + 1;
  if (days < 1) throw new ReportError('invalid_period', 'A data inicial deve ser anterior à final', 'from');
  if (days > REPORT_MAX_DAYS) throw new ReportError('invalid_period', `Período máximo de ${REPORT_MAX_DAYS} dias`, 'from');
  return { from, to };
}

function normalize(v: unknown, type: string): string | number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'bigint') return Number(v);
  if (typeof v === 'boolean') return v ? 'Sim' : 'Não';
  if (Prisma.Decimal.isDecimal(v)) return new Prisma.Decimal(v as Prisma.Decimal).toString();
  if (v instanceof Date) return type === 'date' ? v.toISOString().slice(0, 10) : v.toISOString();
  return typeof v === 'number' ? v : String(v);
}

/**
 * Executa o relatório dentro de uma transação já com o contexto de RLS de quem pediu (API na hora,
 * worker em segundo plano). Q38: o relatório precisa existir para o perfil e as colunas seguem a
 * visibilidade do perfil.
 */
export async function runReport(tx: Tx, kind: ReportKind, q: ReportQuery, limit: number, scope: string): Promise<ReportResult> {
  const def = REPORTS[kind];
  if (!(REPORT_INFO[kind].scopes as readonly string[]).includes(scope)) {
    throw new ReportError('forbidden', 'Este relatório não está disponível para o seu perfil.');
  }
  const columns = def.columns.filter((c) => !(c.hiddenFor as readonly string[] | undefined)?.includes(scope));
  const { from, to } = reportPeriod(q);
  const raw = await tx.$queryRaw<Record<string, unknown>[]>(def.sql({ from, to, commodityId: q.commodityId, limit }));
  const total = raw.length ? Number(raw[0]!.total_count) : 0;
  return {
    kind,
    label: REPORT_INFO[kind].label,
    from,
    to,
    columns: columns.map(({ key, label, type }) => ({ key, label, type })),
    rows: raw.map((r) =>
      columns.map((c) => {
        const value = normalize(r[c.key], c.type);
        return c.labels && typeof value === 'string' ? (c.labels[value] ?? value) : value;
      }),
    ),
    total,
    truncated: total > raw.length,
    generatedAt: new Date().toISOString(),
  };
}
