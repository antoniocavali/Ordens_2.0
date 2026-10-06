'use client';

import type { LoadDto } from '@ordens/contracts';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect } from 'react';
import { PageLoading } from '@/components/shell/page-loading';
import { get } from '@/lib/api';

/**
 * Não existe mais uma tela de cargas: cada carga vive dentro da ordem dela. Este endereço continua
 * só para os links antigos (avisos, auditoria, documentos): `?abrir=<id>` leva à ordem com a carga
 * aberta; sem isso, à lista de ordens.
 */
function Redirect() {
  const router = useRouter();
  const id = useSearchParams().get('abrir');
  useEffect(() => {
    if (!id) return router.replace('/ordens');
    get<LoadDto>(`/loads/${id}`)
      .then((l) => router.replace(`/ordens/${l.order.id}?carga=${l.id}`))
      .catch(() => router.replace('/ordens'));
  }, [id, router]);
  return <PageLoading />;
}

export default function Page() {
  return (
    <Suspense fallback={<PageLoading />}>
      <Redirect />
    </Suspense>
  );
}
