'use client';

import { useEffect } from 'react';

/**
 * Última barreira: falha no próprio layout raiz, quando nem os provedores nem o tema estão de pé.
 * Por isso esta tela traz o seu próprio `html`/`body` e não usa o design system — ela precisa
 * funcionar mesmo que o restante do aplicativo não tenha carregado.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => console.error('[raiz]', error), [error]);
  return (
    <html lang="pt-BR">
      <body style={{ margin: 0, minHeight: '100dvh', display: 'grid', placeItems: 'center', fontFamily: 'system-ui, sans-serif', background: '#0a0a11', color: '#e9e9f0' }}>
        <div style={{ maxWidth: 420, padding: 24, textAlign: 'center' }}>
          <h1 style={{ fontSize: 18, fontWeight: 600, margin: '0 0 8px' }}>Não foi possível carregar a plataforma</h1>
          <p style={{ fontSize: 14, opacity: 0.75, margin: '0 0 20px' }}>Recarregue a página. Se o problema continuar, avise o suporte da Cooperfarms.</p>
          <button
            onClick={() => reset()}
            style={{ border: 0, borderRadius: 10, padding: '10px 18px', background: '#7c3aed', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
          >
            Tentar de novo
          </button>
        </div>
      </body>
    </html>
  );
}
