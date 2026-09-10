import { z } from 'zod';

/**
 * Quantidades e valores trafegam como string decimal ("1234.5600") — nunca float.
 * Aceita ponto como separador decimal; formatação pt-BR é responsabilidade da UI.
 */
export const decimalString = (opts: { scale: number; allowNegative?: boolean } = { scale: 4 }) =>
  z
    .string()
    .trim()
    .regex(
      new RegExp(`^${opts.allowNegative ? '-?' : ''}\\d{1,14}(\\.\\d{1,${opts.scale}})?$`),
      `Número decimal inválido (até ${opts.scale} casas)`,
    );

export const quantityString = decimalString({ scale: 4 });
export const moneyString = decimalString({ scale: 2 });
export const priceString = decimalString({ scale: 6 });
export const percentString = decimalString({ scale: 4 });

/** Compara duas strings decimais sem converter para float. Retorna -1, 0 ou 1. */
export function compareDecimalStrings(a: string, b: string): number {
  const [ai = '0', af = ''] = a.split('.');
  const [bi = '0', bf = ''] = b.split('.');
  const scale = Math.max(af.length, bf.length);
  const na = BigInt(ai + af.padEnd(scale, '0'));
  const nb = BigInt(bi + bf.padEnd(scale, '0'));
  return na === nb ? 0 : na > nb ? 1 : -1;
}
