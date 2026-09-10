import { MULTIPART_PART_SIZE, type DocumentKind, type InitiateUploadResponse, type UploadDto } from '@ordens/contracts';
import { ApiRequestError, get, post } from '@/lib/api';

export interface UploadProgress {
  loaded: number;
  total: number;
}

const PART_CONCURRENCY = 4;
const MAX_RETRIES = 4;

function putWithProgress(url: string, body: Blob, headers: Record<string, string>, onProgress: (loaded: number) => void, signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    Object.entries(headers).forEach(([k, v]) => xhr.setRequestHeader(k, v));
    xhr.upload.onprogress = (e) => onProgress(e.loaded);
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve(xhr.getResponseHeader('ETag') ?? '') : reject(new Error(`HTTP ${xhr.status}`)));
    xhr.onerror = () => reject(new Error('Falha de rede'));
    xhr.onabort = () => reject(new DOMException('Cancelado', 'AbortError'));
    signal.addEventListener('abort', () => xhr.abort(), { once: true });
    xhr.send(body);
  });
}

async function withRetry<T>(fn: () => Promise<T>, signal: AbortSignal): Promise<T> {
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      if (signal.aborted || (err as Error).name === 'AbortError' || attempt >= MAX_RETRIES) throw err;
      attempt++;
      await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
    }
  }
}

function guessMime(file: File): string {
  if (file.type) return file.type;
  const ext = file.name.split('.').pop()?.toLowerCase();
  return ({ xml: 'application/xml', pdf: 'application/pdf', csv: 'text/csv', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg' } as Record<string, string>)[ext ?? ''] ?? 'application/octet-stream';
}

export function kindForFile(file: File): DocumentKind {
  const ext = file.name.split('.').pop()?.toLowerCase();
  if (ext === 'xml') return 'NFE_XML';
  if (ext === 'pdf') return 'PDF';
  if (['jpg', 'jpeg', 'png', 'webp'].includes(ext ?? '')) return 'IMAGE';
  if (['csv', 'xlsx'].includes(ext ?? '')) return 'SPREADSHEET';
  return 'OTHER';
}

/**
 * Envia um arquivo direto ao storage (presigned). A API apenas autoriza e finaliza.
 * Multipart com concorrência, retry exponencial por parte e retomada das partes já enviadas.
 */
export async function uploadFile(opts: {
  file: File;
  entityType: 'loading_order';
  entityId: string;
  onProgress: (p: UploadProgress) => void;
  signal: AbortSignal;
}): Promise<UploadDto> {
  const { file, signal } = opts;
  const idempotencyKey = `${opts.entityId}:${file.name}:${file.size}:${file.lastModified}`.slice(0, 100);
  const init = await post<InitiateUploadResponse>('/uploads', {
    entityType: opts.entityType,
    entityId: opts.entityId,
    kind: kindForFile(file),
    fileName: file.name,
    sizeBytes: file.size,
    mimeType: guessMime(file),
    idempotencyKey,
  });

  const abortOnServer = () => void post(`/uploads/${init.uploadId}/abort`).catch(() => undefined);
  signal.addEventListener('abort', abortOnServer, { once: true });

  try {
    if (init.strategy === 'SINGLE') {
      if (init.url) {
        await withRetry(() => putWithProgress(init.url!, file, init.headers ?? {}, (loaded) => opts.onProgress({ loaded, total: file.size }), signal), signal);
      }
      return await post<UploadDto>(`/uploads/${init.uploadId}/complete`, {});
    }

    const partSize = init.partSize ?? MULTIPART_PART_SIZE;
    const partCount = init.partCount ?? Math.ceil(file.size / partSize);
    const status = await get<UploadDto>(`/uploads/${init.uploadId}`);
    const done = new Map((status.uploadedParts ?? []).map((p) => [p.partNumber, p.etag]));
    const progress = new Map<number, number>();
    done.forEach((_, n) => progress.set(n, Math.min(partSize, file.size - (n - 1) * partSize)));
    const report = () => opts.onProgress({ loaded: [...progress.values()].reduce((a, b) => a + b, 0), total: file.size });
    report();

    const pending = Array.from({ length: partCount }, (_, i) => i + 1).filter((n) => !done.has(n));
    const workers = Array.from({ length: Math.min(PART_CONCURRENCY, pending.length) }, async () => {
      while (pending.length) {
        const n = pending.shift()!;
        const blob = file.slice((n - 1) * partSize, Math.min(n * partSize, file.size));
        const etag = await withRetry(async () => {
          const { parts } = await post<{ parts: { partNumber: number; url: string }[] }>(`/uploads/${init.uploadId}/parts`, { partNumbers: [n] });
          return putWithProgress(parts[0]!.url, blob, {}, (loaded) => {
            progress.set(n, loaded);
            report();
          }, signal);
        }, signal);
        done.set(n, etag);
      }
    });
    await Promise.all(workers);
    return await post<UploadDto>(`/uploads/${init.uploadId}/complete`, {
      parts: [...done.entries()].map(([partNumber, etag]) => ({ partNumber, etag })),
    });
  } catch (err) {
    if (err instanceof ApiRequestError) throw err;
    throw err;
  } finally {
    signal.removeEventListener('abort', abortOnServer);
  }
}
