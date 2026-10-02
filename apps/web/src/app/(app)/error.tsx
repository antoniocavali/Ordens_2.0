'use client';

import { Button, EmptyState } from '@ordens/ui';
import { RotateCw, TriangleAlert } from 'lucide-react';
import { useEffect } from 'react';

/**
 * Falha ao renderizar uma tela. Sem este limite, o erro sobe e o Next mostra a própria tela em
 * inglês, fora do padrão do produto.
 *
 * Caso comum: uma versão nova foi publicada enquanto a aba estava aberta. Os arquivos do build
 * anterior deixam de existir no servidor, a tela seguinte não consegue carregar o próprio código e
 * a única saída é recarregar. Isso é feito automaticamente, uma vez por aba, para não virar laço
 * caso a falha seja outra.
 */
const RECARREGADO = 'ordens:recarregou-apos-falha-de-modulo';

const falhaDeModulo = (e: Error) => /ChunkLoadError|Loading chunk|dynamically imported module|Importing a module script failed/i.test(`${e.name} ${e.message}`);

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('[tela]', error);
    if (!falhaDeModulo(error)) return;
    try {
      if (sessionStorage.getItem(RECARREGADO)) return;
      sessionStorage.setItem(RECARREGADO, '1');
    } catch {
      return; // sem sessionStorage não dá para garantir uma única tentativa: melhor não recarregar
    }
    location.reload();
  }, [error]);

  const desatualizada = falhaDeModulo(error);
  return (
    <div className="mx-auto max-w-3xl px-4 py-16">
      <EmptyState
        icon={<TriangleAlert />}
        title={desatualizada ? 'Uma versão nova foi publicada' : 'Não foi possível abrir esta tela'}
        description={
          desatualizada
            ? 'Esta aba está com a versão anterior do sistema. Recarregue para continuar — nada do que você fez foi perdido.'
            : 'Algo falhou ao montar a tela. Tente de novo; se continuar, recarregue a página.'
        }
        action={
          <div className="flex gap-2">
            <Button onClick={() => reset()} variant="outline">
              Tentar de novo
            </Button>
            <Button onClick={() => location.reload()}>
              <RotateCw /> Recarregar
            </Button>
          </div>
        }
      />
    </div>
  );
}
