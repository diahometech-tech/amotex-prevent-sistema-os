'use client';

// Mapa do rastreio (Leaflet 1.9.4 direto, sem react-leaflet). Não importe este
// arquivo de forma estática: o Leaflet toca em `window`. Use
// `MapaRastreioCarregado`, que o carrega com dynamic(..., { ssr: false }).
//
// Marcadores com L.circleMarker (os PNG padrão do Leaflet quebram no bundler):
// técnico em vermelho Amotex, condomínio em azul. O mapa enquadra os pontos
// sozinho e, a cada atualização, só reenquadra se algum ponto saiu da tela.
import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

/** Tiles do OpenStreetMap (atribuição obrigatória, mostrada no canto do mapa). */
export const URL_TILES_OSM = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
export const ATRIBUICAO_OSM = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>';

const COR_TECNICO = '#d6161f';
const COR_CONDOMINIO = '#2e5c94';
// Sem pontos: centro da cidade de São Paulo.
const CENTRO_PADRAO: L.LatLngExpression = [-23.5505, -46.6333];

export interface PontoMapa {
  id: string;
  lat: number;
  lng: number;
  tipo: 'tecnico' | 'condominio';
  /** Texto fixo ao lado do marcador (nome do técnico) e rótulo acessível. */
  rotulo?: string;
  /** Raio de erro do GPS (m): desenha o círculo quando é pequeno o bastante para ajudar. */
  precisao_m?: number | null;
}

export default function MapaRastreio({
  pontos,
  className = '',
  rotuloAcessivel = 'Mapa com a localização do técnico e do condomínio',
}: {
  pontos: PontoMapa[];
  className?: string;
  rotuloAcessivel?: string;
}) {
  const divRef = useRef<HTMLDivElement>(null);
  const mapaRef = useRef<L.Map | null>(null);
  const camadaRef = useRef<L.LayerGroup | null>(null);
  const ultimoIdsRef = useRef<string>('');

  // Cria o mapa uma vez.
  useEffect(() => {
    if (!divRef.current || mapaRef.current) return;
    const mapa = L.map(divRef.current, { zoomControl: true, attributionControl: true, scrollWheelZoom: false }).setView(CENTRO_PADRAO, 11);
    L.tileLayer(URL_TILES_OSM, { attribution: ATRIBUICAO_OSM, maxZoom: 19 }).addTo(mapa);
    camadaRef.current = L.layerGroup().addTo(mapa);
    mapaRef.current = mapa;
    // O contêiner pode mudar de tamanho depois de montar (modal, abas).
    const obs = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => mapa.invalidateSize()) : null;
    obs?.observe(divRef.current);
    return () => {
      obs?.disconnect();
      mapa.remove();
      mapaRef.current = null;
      camadaRef.current = null;
    };
  }, []);

  // Atualiza marcadores e enquadramento.
  useEffect(() => {
    const mapa = mapaRef.current;
    const camada = camadaRef.current;
    if (!mapa || !camada) return;
    camada.clearLayers();
    for (const p of pontos) {
      const cor = p.tipo === 'tecnico' ? COR_TECNICO : COR_CONDOMINIO;
      if (p.tipo === 'tecnico' && p.precisao_m != null && p.precisao_m >= 20 && p.precisao_m <= 500) {
        L.circle([p.lat, p.lng], { radius: p.precisao_m, color: cor, weight: 1, opacity: 0.4, fillColor: cor, fillOpacity: 0.08, interactive: false }).addTo(camada);
      }
      const m = L.circleMarker([p.lat, p.lng], {
        radius: p.tipo === 'tecnico' ? 9 : 8,
        color: '#ffffff',
        weight: 3,
        fillColor: cor,
        fillOpacity: 1,
      }).addTo(camada);
      if (p.rotulo) m.bindTooltip(p.rotulo, { permanent: true, direction: 'top', offset: [0, -10], opacity: 0.95 });
    }
    if (pontos.length === 0) return;
    const ids = pontos.map((p) => p.id).sort().join('|');
    const limites = L.latLngBounds(pontos.map((p) => [p.lat, p.lng] as L.LatLngTuple));
    const mudouConjunto = ids !== ultimoIdsRef.current;
    ultimoIdsRef.current = ids;
    const algumFora = !mapa.getBounds().contains(limites);
    if (!mudouConjunto && !algumFora) return;
    if (pontos.length === 1) mapa.setView([pontos[0].lat, pontos[0].lng], 16);
    else mapa.fitBounds(limites, { padding: [40, 40], maxZoom: 17 });
  }, [pontos]);

  return (
    <div
      ref={divRef}
      role="img"
      aria-label={rotuloAcessivel}
      className={`isolate w-full h-[260px] rounded-lg overflow-hidden border border-amx-line bg-amx-panel-2 ${className}`}
    />
  );
}
