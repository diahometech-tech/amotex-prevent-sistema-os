// Montagem da resposta do rastreio (servidor). A regra de verdade está em
// src/lib/rastreio.ts; aqui só se junta OS + condomínio + última posição.
import type { Condominio, OS, OsPosicao, User } from './db';
import { estimarChegada, posicaoVelha, rastreioAtivo, type Coordenada, type Estimativa } from './rastreio';

export interface PosicaoPublica {
  lat: number;
  lng: number;
  precisao_m: number | null;
  registrado_em: string;
}

export interface RastreioOS {
  ativo: boolean;
  tecnico_nome: string | null;
  a_caminho_em: string | null;
  posicao: PosicaoPublica | null;
  destino: Coordenada | null;
  estimativa: Estimativa | null;
  posicao_velha: boolean;
}

function iso(v: unknown): string {
  return new Date(v as string | number | Date).toISOString();
}

export function destinoDoCondominio(c: Pick<Condominio, 'lat' | 'lng'> | null | undefined): Coordenada | null {
  if (!c || c.lat == null || c.lng == null) return null;
  return { lat: Number(c.lat), lng: Number(c.lng) };
}

/**
 * Resposta do rastreio de uma OS. Com `ativo = false` NÃO devolve posição nem
 * estimativa: depois da chegada (ou da janela de 2 h) ninguém vê coordenada do
 * técnico. Nunca devolve o histórico do trajeto, só a última posição.
 */
export function montarRastreio(
  os: OS,
  condominio: Condominio | null,
  tecnico: Pick<User, 'nome'> | null,
  ultima: OsPosicao | null,
  agora: number = Date.now()
): RastreioOS {
  const ativo = rastreioAtivo(os, agora);
  const destino = destinoDoCondominio(condominio);
  const posicao: PosicaoPublica | null =
    ativo && ultima
      ? { lat: ultima.lat, lng: ultima.lng, precisao_m: ultima.precisao_m ?? null, registrado_em: iso(ultima.registrado_em) }
      : null;
  return {
    ativo,
    tecnico_nome: tecnico?.nome ?? os.a_caminho_por ?? null,
    a_caminho_em: os.a_caminho_em ? iso(os.a_caminho_em) : null,
    posicao,
    destino,
    estimativa: posicao ? estimarChegada(posicao, destino) : null,
    posicao_velha: posicao ? posicaoVelha(posicao.registrado_em, agora) : false,
  };
}
