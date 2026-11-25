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

export type ResultadoPedido = 'ok' | 'negada' | 'sem_gps' | 'indisponivel';
export type EstadoPermissao = 'granted' | 'denied' | 'prompt' | 'desconhecido';

/**
 * Pede a localização para o navegador mostrar a janela de permissão. Chame
 * direto do toque do usuário (antes de qualquer outro await): vários
 * navegadores de celular silenciam o pedido feito fora do gesto.
 */
export function pedirLocalizacao(): Promise<ResultadoPedido> {
  return new Promise((resolve) => {
    try {
      if (typeof navigator === 'undefined' || !navigator.geolocation) return resolve('indisponivel');
      const reserva = setTimeout(() => resolve('sem_gps'), 10_000 + 1500);
      navigator.geolocation.getCurrentPosition(
        () => {
          clearTimeout(reserva);
          resolve('ok');
        },
        (erro) => {
          clearTimeout(reserva);
          resolve(erro?.code === 1 ? 'negada' : 'sem_gps');
        },
        { enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 }
      );
    } catch {
      resolve('indisponivel');
    }
  });
}

/** Estado da permissão sem abrir a janela. Onde não há API (Safari antigo): 'desconhecido'. */
export async function estadoPermissaoLocalizacao(): Promise<EstadoPermissao> {
  try {
    if (typeof navigator === 'undefined' || !navigator.permissions?.query) return 'desconhecido';
    const r = await navigator.permissions.query({ name: 'geolocation' });
    return r.state === 'granted' || r.state === 'denied' || r.state === 'prompt' ? r.state : 'desconhecido';
  } catch {
    return 'desconhecido';
  }
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
