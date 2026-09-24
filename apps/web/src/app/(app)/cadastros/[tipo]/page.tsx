'use client';

import { Building2, UserRound } from 'lucide-react';
import { notFound } from 'next/navigation';
import { Suspense, use } from 'react';
import { FarmsPage } from '@/features/registry/farms-page';
import { PartnersPage } from '@/features/registry/partners-page';

export default function RegistryRoute({ params }: { params: Promise<{ tipo: string }> }) {
  const { tipo } = use(params);
  const page = (() => {
    switch (tipo) {
      case 'vendedores':
        return <PartnersPage role="SELLER" title="Vendedores" description="Produtores, cooperados e cooperativas que vendem para a Matriz." icon={<UserRound />} entityLabel="Vendedor" />;
      case 'compradores':
        return <PartnersPage role="BUYER" title="Compradores" description="Destinatários das ordens de carregamento." icon={<Building2 />} entityLabel="Comprador" />;
      case 'fazendas':
        return <FarmsPage />;
      // Transportadoras, motoristas, veículos e locais não têm cadastro: são digitados nos formulários.
      default:
        return null;
    }
  })();
  if (!page) notFound();
  return <Suspense>{page}</Suspense>;
}
