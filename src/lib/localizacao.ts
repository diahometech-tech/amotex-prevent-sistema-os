// Localização do celular na chegada e na finalização (22/11). Puro, sem I/O,
// serve ao servidor (validação) e à tela (texto e link do mapa).

export interface Localizacao {
  lat: number;
  lng: number;
  /** Raio de erro em metros, quando o aparelho informa. */
  precisao_m?: number;
}

function numeroOuNada(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/**
 * Lê `<prefixo>_lat`, `<prefixo>_lng` e `<prefixo>_precisao_m` do corpo de um
 * pedido. Coordenada fora do mundo ou incompleta vira `null` (ignorada: a
 * chegada nunca é recusada por causa da localização).
 */
export function lerLocalizacao(corpo: Record<string, unknown>, prefixo: 'chegada' | 'finalizacao'): Localizacao | null {
  const lat = numeroOuNada(corpo[`${prefixo}_lat`]);
  const lng = numeroOuNada(corpo[`${prefixo}_lng`]);
  if (lat === undefined || lng === undefined) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  const p = numeroOuNada(corpo[`${prefixo}_precisao_m`]);
  return { lat, lng, ...(p !== undefined && p >= 0 ? { precisao_m: Math.min(Math.round(p), 100_000) } : {}) };
}

/** Campos do banco para um prefixo, a partir de uma localização. */
export function camposDeLocalizacao(prefixo: 'chegada' | 'finalizacao', loc: Localizacao): Record<string, number> {
  return {
    [`${prefixo}_lat`]: loc.lat,
    [`${prefixo}_lng`]: loc.lng,
    ...(loc.precisao_m !== undefined ? { [`${prefixo}_precisao_m`]: loc.precisao_m } : {}),
  };
}

/** Link do Google Maps nas coordenadas. */
export function linkMapaCoordenadas(lat: number, lng: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${lat.toFixed(6)},${lng.toFixed(6)}`;
}

/** "±15 m" ou "±1,2 km"; vazio quando não há precisão. */
export function textoPrecisao(m?: number | null): string {
  if (m === undefined || m === null || !Number.isFinite(m)) return '';
  if (m >= 1000) return `±${(m / 1000).toFixed(1).replace('.', ',')} km`;
  return `±${Math.round(m)} m`;
}
