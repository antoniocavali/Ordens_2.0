import type { ApiError } from '@ordens/contracts';

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: { fields?: Record<string, string[]> } & Record<string, unknown>,
    readonly requestId?: string,
  ) {
    super(message);
  }

  get fieldErrors(): Record<string, string[]> {
    return this.details?.fields ?? {};
  }
}

function csrfToken(): string | undefined {
  if (typeof document === 'undefined') return undefined;
  return document.cookie
    .split('; ')
    .find((c) => c.startsWith('ordens_csrf='))
    ?.split('=')[1];
}

type Query = Record<string, string | number | boolean | null | undefined | string[]>;

function toQuery(params?: Query): string {
  if (!params) return '';
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    if (Array.isArray(v)) v.forEach((item) => sp.append(k, item));
    else sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

/** Cliente da API (mesma origem via rewrite do Next). Envia cookies e X-CSRF-Token. */
export async function api<T>(method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: string, options: { body?: unknown; query?: Query; signal?: AbortSignal } = {}): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  if (method !== 'GET') {
    const token = csrfToken();
    if (token) headers['x-csrf-token'] = token;
  }

  let res: Response;
  try {
    res = await fetch(`/api${path}${toQuery(options.query)}`, {
      method,
      headers,
      credentials: 'same-origin',
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: options.signal,
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new ApiRequestError(0, 'NETWORK', 'Sem conexão com o servidor. Verifique sua internet.');
  }

  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const data = text ? (JSON.parse(text) as unknown) : undefined;
  if (!res.ok) {
    const err = (data as ApiError | undefined)?.error;
    if (res.status === 401 && typeof window !== 'undefined' && !path.startsWith('/auth/')) {
      window.dispatchEvent(new CustomEvent('ordens:unauthenticated'));
    }
    throw new ApiRequestError(
      res.status,
      err?.code ?? 'UNKNOWN',
      err?.message ?? 'Ocorreu um erro inesperado.',
      err?.details as ApiRequestError['details'],
      err?.requestId,
    );
  }
  return data as T;
}

export const get = <T>(path: string, query?: Query, signal?: AbortSignal) => api<T>('GET', path, { query, signal });
export const post = <T>(path: string, body?: unknown) => api<T>('POST', path, { body: body ?? {} });
export const patch = <T>(path: string, body: unknown) => api<T>('PATCH', path, { body });
export const put = <T>(path: string, body: unknown) => api<T>('PUT', path, { body });
export const del = <T>(path: string) => api<T>('DELETE', path);
