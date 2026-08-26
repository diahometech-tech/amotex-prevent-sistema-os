import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ['pg', 'bcrypt'],
  async headers() {
    return [
      {
        // Páginas HTML nunca ficam em cache — sempre busca versão nova
        source: '/((?!_next/static|_next/image|favicon|uploads|icons|manifest).*)',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Pragma', value: 'no-cache' },
        ],
      },
      {
        // Assets estáticos do Next (já têm hash no nome) — cache longo OK
        source: '/_next/static/:path*',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
        ],
      },
    ];
  },
};

export default nextConfig;
