import type { MetadataRoute } from 'next';

// App instalável (PWA). Cores da marca: fundo azul-marinho (--bg-primary).
// Os ícones são PNG versionados em /public (gerados a partir do logo).
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'Amotex Prevent',
    short_name: 'Amotex',
    description: 'Ordens de serviço, checklists e avisos de manutenção de condomínios.',
    lang: 'pt-BR',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#0B1E3A',
    theme_color: '#0B1E3A',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
