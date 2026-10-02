import { Skeleton } from '@ordens/ui';

/**
 * Esqueleto de tela: título, cartões e lista. Serve de `fallback` para o Suspense de cada página e
 * de `loading.tsx` do App Router, para que nenhuma navegação mostre a área de conteúdo vazia —
 * sem indicação, uma tela que demora é indistinguível de uma tela quebrada.
 */
export function PageLoading() {
  return (
    <div className="mx-auto flex max-w-450 flex-col gap-5 px-4 py-6 sm:px-6 lg:px-8" aria-busy="true" aria-live="polite">
      <span className="sr-only">Carregando a tela…</span>
      <div className="flex items-center gap-3.5">
        <Skeleton className="size-11 rounded-xl" />
        <div className="space-y-2">
          <Skeleton className="h-6 w-56" />
          <Skeleton className="h-4 w-80" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
      <Skeleton className="h-96" />
    </div>
  );
}
