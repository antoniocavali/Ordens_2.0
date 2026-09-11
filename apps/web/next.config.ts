import path from 'node:path';
import type { NextConfig } from 'next';

const apiUrl = process.env.API_INTERNAL_URL ?? 'http://localhost:4000';

/**
 * BFF limitado (ADR-004): apenas rewrite de /api/* para a API na mesma origem.
 * Uploads vão direto ao storage; tempo real terá rota dedicada no ingress.
 */
const config: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: path.join(import.meta.dirname, '../..'),
  transpilePackages: ['@ordens/ui'],
  poweredByHeader: false,
  async rewrites() {
    return [
      { source: '/api/:path*', destination: `${apiUrl}/:path*` },
      // Dev/compose: SSE pela mesma origem. Em produção o ingress roteia /realtime direto para a API (ADR-004).
      { source: '/realtime/:path*', destination: `${apiUrl}/realtime/:path*` },
    ];
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default config;
