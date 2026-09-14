import { Prisma } from './generated/prisma/client.js';

/** Chaves nunca gravadas em auditoria nem expostas em payloads. */
export const SENSITIVE_KEYS = new Set([
  'passwordHash',
  'password_hash',
  'password',
  'secretEnc',
  'secret_enc',
  'tokenHash',
  'token_hash',
  'codeHash',
  'code_hash',
  'publicKey',
  'credentialId',
]);

/**
 * Converte valores para JSON seguro: Decimal → string, BigInt → string, Date → ISO,
 * Buffer/Uint8Array → omitido, chaves sensíveis → removidas.
 */
export function toAuditJson(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  const out = normalize(value);
  return out === null || out === undefined ? Prisma.JsonNull : (out as Prisma.InputJsonValue);
}

function normalize(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (Prisma.Decimal.isDecimal(value)) return (value as Prisma.Decimal).toString();
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Uint8Array) return undefined;
  if (Array.isArray(value)) return value.map(normalize);
  if (typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEYS.has(k)) continue;
      const n = normalize(v);
      if (n !== undefined) result[k] = n;
    }
    return result;
  }
  return value;
}

/** Diferença rasa entre dois objetos já normalizados. */
export function shallowDiff(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  fields?: readonly string[],
): { field: string; from: unknown; to: unknown }[] {
  const keys = fields ?? Array.from(new Set([...Object.keys(before), ...Object.keys(after)]));
  const changes: { field: string; from: unknown; to: unknown }[] = [];
  for (const key of keys) {
    if (SENSITIVE_KEYS.has(key)) continue;
    const a = normalize(before[key]);
    const b = normalize(after[key]);
    if (JSON.stringify(a) !== JSON.stringify(b)) changes.push({ field: key, from: a, to: b });
  }
  return changes;
}
