import type { Metadata } from 'next';
import { Presentation } from '@/features/guide/presentation';

export const metadata: Metadata = {
  title: 'Apresentação',
  description: 'Conheça a plataforma de Ordens de Carregamento da Cooperfarms: do pedido ao caminhão na estrada, com Matriz, Fazendas e Compradores no mesmo processo.',
};

/** Apresentação institucional. Pública: abre sem login, fora do shell da aplicação. */
export default function PresentationPage() {
  return <Presentation />;
}
