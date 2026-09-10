/** Aritmética de strings decimais com BigInt — nunca float para quantidades e valores. */

function parts(v: string): { int: bigint; scale: number } {
  const neg = v.startsWith('-');
  const [i = '0', f = ''] = (neg ? v.slice(1) : v).split('.');
  const int = BigInt((i || '0') + f);
  return { int: neg ? -int : int, scale: f.length };
}

function toStr(int: bigint, scale: number): string {
  const neg = int < 0n;
  const abs = (neg ? -int : int).toString().padStart(scale + 1, '0');
  const i = abs.slice(0, abs.length - scale);
  const f = scale ? abs.slice(abs.length - scale).replace(/0+$/, '') : '';
  return `${neg ? '-' : ''}${i}${f ? `.${f}` : ''}`;
}

function align(a: string, b: string): [bigint, bigint, number] {
  const pa = parts(a);
  const pb = parts(b);
  const scale = Math.max(pa.scale, pb.scale);
  return [pa.int * 10n ** BigInt(scale - pa.scale), pb.int * 10n ** BigInt(scale - pb.scale), scale];
}

const valid = (v: string | null | undefined): v is string => Boolean(v && /^-?\d+(\.\d+)?$/.test(v));

export function addDec(a: string, b: string): string {
  const [x, y, s] = align(a, b);
  return toStr(x + y, s);
}

export function subDec(a: string, b: string): string {
  const [x, y, s] = align(a, b);
  return toStr(x - y, s);
}

/** Multiplica e arredonda (half-up) para `scale` casas. */
export function mulDec(a: string | null | undefined, b: string | null | undefined, scale = 2): string | null {
  if (!valid(a) || !valid(b)) return null;
  const pa = parts(a);
  const pb = parts(b);
  const raw = pa.int * pb.int;
  const rawScale = pa.scale + pb.scale;
  if (rawScale <= scale) return toStr(raw * 10n ** BigInt(scale - rawScale), scale);
  const div = 10n ** BigInt(rawScale - scale);
  const half = div / 2n;
  const rounded = raw >= 0n ? (raw + half) / div : (raw - half) / div;
  return toStr(rounded, scale);
}

export function cmpDec(a: string, b: string): number {
  const [x, y] = align(a, b);
  return x === y ? 0 : x > y ? 1 : -1;
}

export const isPositiveDec = (v: string | null | undefined) => valid(v) && cmpDec(v, '0') > 0;
