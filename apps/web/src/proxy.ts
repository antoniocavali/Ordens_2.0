import { NextResponse, type NextRequest } from 'next/server';

const dev = process.env.NODE_ENV !== 'production';

/** Origem do storage (URLs assinadas de upload/download vão direto do navegador ao S3/MinIO). */
function storageOrigin(): string | null {
  try {
    return process.env.S3_PUBLIC_ENDPOINT ? new URL(process.env.S3_PUBLIC_ENDPOINT).origin : null;
  } catch {
    return null;
  }
}

/**
 * Content-Security-Policy das páginas (revisão de segurança 3.3). Montada em tempo de execução para
 * incluir a origem do storage. Scripts ainda usam 'unsafe-inline' por causa dos scripts inline do
 * App Router; a troca por nonce está na lista de ajustes de produção.
 */
function contentSecurityPolicy(): string {
  const storage = storageOrigin();
  const directives: Record<string, string[]> = {
    'default-src': ["'self'"],
    'script-src': ["'self'", "'unsafe-inline'", ...(dev ? ["'unsafe-eval'"] : [])],
    'style-src': ["'self'", "'unsafe-inline'"],
    'img-src': ["'self'", 'data:', 'blob:', ...(storage ? [storage] : [])],
    'font-src': ["'self'", 'data:'],
    'connect-src': ["'self'", ...(storage ? [storage] : []), ...(dev ? ['ws:', 'wss:'] : [])],
    'frame-ancestors': ["'none'"],
    'base-uri': ["'none'"],
    'form-action': ["'self'"],
    'object-src': ["'none'"],
    'worker-src': ["'self'", 'blob:'],
    'manifest-src': ["'self'"],
  };
  return Object.entries(directives)
    .map(([name, values]) => `${name} ${values.join(' ')}`)
    .join('; ');
}

export function proxy(request: NextRequest) {
  const response = NextResponse.next();
  response.headers.set('Content-Security-Policy', contentSecurityPolicy());
  // HSTS só faz sentido (e só é respeitado) em HTTPS: vale automaticamente atrás do ingress com TLS.
  const proto = request.headers.get('x-forwarded-proto') ?? request.nextUrl.protocol.replace(':', '');
  if (proto === 'https') response.headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains');
  return response;
}

export const config = {
  // Páginas da aplicação; API, tempo real e arquivos estáticos ficam de fora.
  matcher: ['/((?!api/|realtime/|_next/static|_next/image|favicon.ico|icon.svg|brand/|manifest.webmanifest).*)'],
};
