import type { Tx } from './client.js';

/**
 * Próximo valor de uma sequência por tenant/ano, atômico dentro da transação
 * (INSERT … ON CONFLICT DO UPDATE bloqueia a linha até o commit).
 */
export async function nextSequence(tx: Tx, tenantId: string, name: string, year: number): Promise<number> {
  const rows = await tx.$queryRaw<{ value: number }[]>`
    insert into tenant_sequences (tenant_id, name, year, value)
    values (${tenantId}::uuid, ${name}, ${year}, 1)
    on conflict (tenant_id, name, year)
    do update set value = tenant_sequences.value + 1
    returning value
  `;
  const value = rows[0]?.value;
  if (value === undefined) throw new Error('Falha ao gerar sequência');
  return Number(value);
}
