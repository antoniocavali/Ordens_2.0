/**
 * Formatação pt-BR. Valores chegam como string decimal e são formatados sem aritmética de float.
 * Para exibição, Intl.NumberFormat aceita string numérica diretamente (sem perda em números grandes).
 */
const qtyFmt = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 });
const qtyCompact = new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 });
const moneyFmt = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const moneyCompact = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', notation: 'compact', maximumFractionDigits: 2 });

type Num = string | null | undefined;
const asIntl = (v: string) => v as unknown as number; // Intl.NumberFormat.format aceita string decimal (ES2023)

export function formatQty(v: Num, unit?: string): string {
  if (v == null || v === '') return '—';
  return `${qtyFmt.format(asIntl(v))}${unit ? ` ${unit}` : ''}`;
}

export function formatQtyCompact(v: Num, unit?: string): string {
  if (v == null || v === '') return '—';
  return `${qtyCompact.format(asIntl(v))}${unit ? ` ${unit}` : ''}`;
}

export function formatMoney(v: Num, currency = 'BRL', compact = false): string {
  if (v == null || v === '') return '—';
  if (currency !== 'BRL') {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency, ...(compact ? { notation: 'compact' } : {}) }).format(asIntl(v));
  }
  return (compact ? moneyCompact : moneyFmt).format(asIntl(v));
}

/** Percentual (0–100) de a sobre b, apenas para largura de barras visuais. */
export function ratio(a: Num, b: Num): number {
  const x = Number(a ?? 0);
  const y = Number(b ?? 0);
  if (!y) return 0;
  return Math.max(0, Math.min(100, (x / y) * 100));
}

const dateFmt = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' });
const shortDate = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', timeZone: 'UTC' });
const dateTimeFmt = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const timeFmt = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' });

export const formatDate = (v: string | null | undefined) => (v ? dateFmt.format(new Date(v.length === 10 ? `${v}T00:00:00Z` : v)) : '—');
export const formatShortDate = (v: string | null | undefined) =>
  v ? shortDate.format(new Date(v.length === 10 ? `${v}T00:00:00Z` : v)).replace('.', '') : '—';
export const formatDateTime = (v: string | null | undefined) => (v ? dateTimeFmt.format(new Date(v)) : '—');
export const formatTime = (v: string | null | undefined) => (v ? timeFmt.format(new Date(v)) : '—');

const rtf = new Intl.RelativeTimeFormat('pt-BR', { numeric: 'auto' });
export function formatRelative(v: string | null | undefined): string {
  if (!v) return '—';
  const diff = (new Date(v).getTime() - Date.now()) / 1000;
  const abs = Math.abs(diff);
  if (abs < 60) return 'agora';
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
  if (abs < 86400 * 30) return rtf.format(Math.round(diff / 86400), 'day');
  return formatDate(v);
}

/** Converte entrada pt-BR ("1.250,5") em string decimal ("1250.5") sem float. */
export function parseDecimalInput(raw: string): string {
  const cleaned = raw.replace(/\s/g, '').replace(/\./g, '').replace(',', '.');
  return /^\d*\.?\d*$/.test(cleaned) ? cleaned.replace(/^\./, '0.').replace(/\.$/, '') : '';
}

/** Mostra string decimal no formato de edição pt-BR. */
export function toDecimalInput(v: string | null | undefined): string {
  if (!v) return '';
  const [i = '0', f] = v.split('.');
  const int = i.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return f ? `${int},${f}` : int;
}
