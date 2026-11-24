// Acompanhamento da rota do técnico (24/11): regras puras, sem I/O, usadas pelo
// servidor (rotas /api/os/[id]/posicao, /api/os/[id]/rastreio e /api/rastreio)
// e pelas telas (texto da estimativa, "atualizado há X").
//
// Janela do rastreio: começa em "Estou a caminho" e acaba na chegada, no
// encerramento da OS ou 2 horas depois — o que vier primeiro. Depois disso o
// técnico para de enviar e ninguém mais vê coordenada (regra do #32: o
// condomínio não vê localização depois da chegada).
import type { OS, UserRole } from './db';

/** Por quanto tempo, depois de "Estou a caminho", o rastreio fica ativo. */
export const LIMITE_RASTREIO_MS = 2 * 3_600_000;
/** Sem atualização há mais que isto, a tela avisa que a posição está velha. */
export const POSICAO_VELHA_MS = 2 * 60_000;
/** Posições mais antigas que isto são apagadas ao gravar uma nova. */
export const DIAS_RETENCAO_POSICAO = 7;
/** Intervalo mínimo entre duas gravações da mesma OS (anti-enxurrada). */
export const INTERVALO_MIN_POSICAO_MS = 5_000;
/** Precisão pior que isto (em metros) não vale a pena gravar. */
export const PRECISAO_MAXIMA_M = 1000;
/** Precisão boa o bastante para gravar a localização do condomínio pela chegada. */
export const PRECISAO_CHEGADA_M = 100;
/** Estimativa: caminho real é ~40% maior que a linha reta; velocidade média urbana. */
export const FATOR_RUAS = 1.4;
export const VELOCIDADE_KMH = 25;

export interface Coordenada {
  lat: number;
  lng: number;
}

type CampoOS = Pick<OS, 'status'> & Partial<Pick<OS, 'a_caminho_em' | 'entrada_em'>>;

function ms(v: unknown): number {
  // pg devolve Date; o backend JSON, string ISO.
  return new Date(v as string | number | Date).getTime();
}

/** A OS está no trecho "a caminho" e dentro da janela de 2 horas? */
export function rastreioAtivo(os: CampoOS, agora: number = Date.now()): boolean {
  if (!os.a_caminho_em) return false;
  if (os.entrada_em) return false;
  if (os.status === 'finalizada' || os.status === 'cancelada') return false;
  const desde = agora - ms(os.a_caminho_em);
  if (Number.isNaN(desde)) return false;
  return desde < LIMITE_RASTREIO_MS;
}

/** Distância em linha reta entre dois pontos (km). */
export function distanciaKm(a: Coordenada, b: Coordenada): number {
  const rad = (g: number) => (g * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

export interface Estimativa {
  distancia_km: number;
  minutos: number;
}

/**
 * Estimativa de chegada sem serviço externo: linha reta × 1,4 (ruas) a 25 km/h,
 * arredondada para cima, no mínimo 1 min. Sem coordenada do condomínio ou do
 * técnico, não há estimativa (`null`). `distancia_km` é a linha reta, com 2
 * casas.
 */
export function estimarChegada(posicao: Coordenada | null | undefined, destino: Coordenada | null | undefined): Estimativa | null {
  if (!posicao || !destino) return null;
  const reta = distanciaKm(posicao, destino);
  const minutos = Math.max(1, Math.ceil(((reta * FATOR_RUAS) / VELOCIDADE_KMH) * 60 - 1e-9));
  return { distancia_km: Math.round(reta * 100) / 100, minutos };
}

/** Última posição tem mais de 2 minutos? */
export function posicaoVelha(registradoEm: string | Date | null | undefined, agora: number = Date.now()): boolean {
  if (!registradoEm) return false;
  return agora - ms(registradoEm) > POSICAO_VELHA_MS;
}

export type SessaoRastreio = { id: string; role: UserRole };
type OsDoRastreio = Pick<OS, 'condominio_id'> & Partial<Pick<OS, 'tecnico_id'>>;

/**
 * Quem pode LER o rastreio de uma OS: gestor e secretária, qualquer OS;
 * síndico, só do próprio condomínio (`condominioDoUsuario` vem do banco, nunca
 * do cliente); técnico, só a OS dele. Qualquer outro caso, negado.
 */
export function podeLerRastreio(sessao: SessaoRastreio, os: OsDoRastreio, condominioDoUsuario?: string | null): boolean {
  switch (sessao.role) {
    case 'admin':
    case 'secretaria':
      return true;
    case 'sindico':
      return !!condominioDoUsuario && condominioDoUsuario === os.condominio_id;
    case 'tecnico':
      return !!os.tecnico_id && os.tecnico_id === sessao.id;
    default:
      return false;
  }
}

/** Quem pode ENVIAR posição: só o técnico, e só o da OS. Nem o gestor envia por ele. */
export function podeEnviarPosicao(sessao: SessaoRastreio, os: OsDoRastreio): boolean {
  return sessao.role === 'tecnico' && !!os.tecnico_id && os.tecnico_id === sessao.id;
}

/** Lista geral de técnicos a caminho: só o escritório. */
export function podeVerMapaGeral(role?: UserRole): boolean {
  return role === 'admin' || role === 'secretaria';
}

/** Coordenada válida (números finitos dentro dos limites do mundo). */
export function coordenadaValida(lat: unknown, lng: unknown): lat is number {
  return (
    typeof lat === 'number' && typeof lng === 'number' &&
    Number.isFinite(lat) && Number.isFinite(lng) &&
    lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180
  );
}

/** A chegada pode preencher a localização do condomínio? (precisão ≤ 100 m e condomínio ainda sem ponto) */
export function chegadaPreencheCondominio(
  condominio: { lat?: number | null; lng?: number | null },
  chegada: { precisao_m?: number } | null
): boolean {
  if (!chegada || chegada.precisao_m === undefined) return false;
  if (condominio.lat != null && condominio.lng != null) return false;
  return chegada.precisao_m <= PRECISAO_CHEGADA_M;
}

// ===== Textos =====

/** "~12 min" / "~1h05". */
export function textoMinutos(min: number): string {
  if (min < 60) return `~${min} min`;
  const h = Math.floor(min / 60);
  const r = min % 60;
  return r ? `~${h}h${String(r).padStart(2, '0')}` : `~${h}h`;
}

/** "agora", "há 3 min", "há 2 h". */
export function textoHa(desdeMs: number, agora: number = Date.now()): string {
  const s = Math.max(0, Math.round((agora - desdeMs) / 1000));
  if (s < 30) return 'agora';
  const min = Math.round(s / 60);
  if (min < 1) return 'há 1 min';
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  return `há ${h} h`;
}

/** "3 min" (sem "há"): para "Sem atualização da localização há X". */
export function textoDuracao(desdeMs: number, agora: number = Date.now()): string {
  const min = Math.max(1, Math.round((agora - desdeMs) / 60_000));
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  return `${h} h`;
}

/** Cola "lat, lng" (Google Maps, botão direito) ou link com `@lat,lng` / `?q=lat,lng` / `!3dLAT!4dLNG`. */
export function lerCoordenadaColada(texto: string): Coordenada | null {
  const t = texto.trim();
  if (!t) return null;
  const num = '(-?\\d{1,3}(?:\\.\\d+)?)';
  const padroes = [
    new RegExp(`^${num}\\s*[,;\\s]\\s*${num}$`),
    new RegExp(`@${num},${num}`),
    new RegExp(`!3d${num}!4d${num}`),
    new RegExp(`[?&](?:q|query|ll|center)=${num}(?:,|%2C)${num}`),
  ];
  for (const p of padroes) {
    const m = t.match(p);
    if (!m) continue;
    const lat = Number(m[1]);
    const lng = Number(m[2]);
    if (coordenadaValida(lat, lng)) return { lat, lng };
  }
  // Vírgula decimal brasileira ("-23,5505 -46,6333") não é aceita de propósito: é ambígua.
  return null;
}
