/** Padrão ILIKE com escape de curingas digitados pelo usuário. */
export const likePattern = (q: string) => `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;

export const toDate = (v: string | null | undefined) => (v ? new Date(`${v}T00:00:00.000Z`) : null);
export const fromDate = (v: Date | null | undefined) => (v ? v.toISOString().slice(0, 10) : null);
