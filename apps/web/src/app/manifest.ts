import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Cooperfarms Ordens',
    short_name: 'Cooperfarms',
    description: 'Gestão de Ordens de Carregamento para o agronegócio',
    start_url: '/',
    display: 'standalone',
    background_color: '#F5F5F8',
    theme_color: '#6D28D9',
    icons: [
      { src: '/brand/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/brand/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
  };
}
