'use client';

import { Building2, Boxes, UserRound } from 'lucide-react';
import { notFound } from 'next/navigation';
import { Suspense, use } from 'react';
import { FarmsPage } from '@/features/registry/farms-page';
import { DriversPage, VehiclesPage } from '@/features/registry/fleet-pages';
import { PartnersPage } from '@/features/registry/partners-page';

export default function RegistryRoute({ params }: { params: Promise<{ tipo: string }> }) {
  const { tipo } = use(params);
  const page = (() => {
    switch (tipo) {
      case 'vendedores':
        return <PartnersPage role="SELLER" title="Vendedores" description="Produtores, cooperados e cooperativas que vendem para a Matriz." icon={<UserRound />} entityLabel="Vendedor" />;
      case 'compradores':
        return <PartnersPage role="BUYER" title="Compradores" description="Destinatários das ordens de carregamento." icon={<Building2 />} entityLabel="Comprador" />;
      case 'transportadoras':
        return <PartnersPage role="CARRIER" title="Transportadoras" description="Empresas de transporte, RNTRC, motoristas e frota." icon={<Boxes />} entityLabel="Transportadora" />;
      case 'fazendas':
        return <FarmsPage />;
      case 'motoristas':
        return <DriversPage />;
      case 'veiculos':
        return <VehiclesPage />;
      default:
        return null;
    }
  })();
  if (!page) notFound();
  return <Suspense>{page}</Suspense>;
}
