'use client';

// Versão do mapa que só carrega no navegador (o Leaflet usa `window`).
import dynamic from 'next/dynamic';
import React from 'react';

export type { PontoMapa } from './MapaRastreio';

export const MapaRastreioCarregado = dynamic(() => import('./MapaRastreio'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-[260px] rounded-lg border border-amx-line bg-amx-panel-2 flex items-center justify-center text-xs text-amx-muted">
      Carregando o mapa...
    </div>
  ),
});
