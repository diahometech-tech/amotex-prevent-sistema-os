'use client';

// Pede a localização do celular (só no navegador). Nunca bloqueia nem lança:
// sem permissão, sem sinal de GPS, sem suporte ou depois do tempo limite devolve
// `null`, e quem chamou registra a chegada/finalização mesmo assim.
import type { Localizacao } from './localizacao';

export const TEMPO_LIMITE_LOCALIZACAO_MS = 8000;

export function obterLocalizacao(): Promise<Localizacao | null> {
  return new Promise((resolve) => {
    try {
      if (typeof navigator === 'undefined' || !navigator.geolocation) return resolve(null);
      // Rede de segurança: alguns navegadores não chamam nenhum retorno quando o
      // aparelho está sem GPS e o aviso de permissão fica aberto.
      const reserva = window.setTimeout(() => resolve(null), TEMPO_LIMITE_LOCALIZACAO_MS + 1500);
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          window.clearTimeout(reserva);
          const { latitude, longitude, accuracy } = pos.coords;
          resolve({
            lat: latitude,
            lng: longitude,
            ...(Number.isFinite(accuracy) ? { precisao_m: Math.round(accuracy) } : {}),
          });
        },
        () => {
          window.clearTimeout(reserva);
          resolve(null);
        },
        { enableHighAccuracy: true, timeout: TEMPO_LIMITE_LOCALIZACAO_MS, maximumAge: 0 }
      );
    } catch {
      resolve(null);
    }
  });
}

/** Corpo do PATCH com a localização, no formato que o servidor lê. */
export function corpoComLocalizacao(prefixo: 'chegada' | 'finalizacao', loc: Localizacao | null): Record<string, number> {
  if (!loc) return {};
  return {
    [`${prefixo}_lat`]: loc.lat,
    [`${prefixo}_lng`]: loc.lng,
    ...(loc.precisao_m !== undefined ? { [`${prefixo}_precisao_m`]: loc.precisao_m } : {}),
  };
}
