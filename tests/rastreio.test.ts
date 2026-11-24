import { describe, expect, it } from 'vitest';
import {
  LIMITE_RASTREIO_MS, POSICAO_VELHA_MS, chegadaPreencheCondominio, coordenadaValida, distanciaKm,
  estimarChegada, lerCoordenadaColada, podeEnviarPosicao, podeLerRastreio, podeVerMapaGeral,
  posicaoVelha, rastreioAtivo, textoHa, textoMinutos,
} from '../src/lib/rastreio';

const AGORA = Date.parse('2026-11-24T15:00:00Z');
const aCaminho = (msAtras: number) => new Date(AGORA - msAtras).toISOString();

describe('rastreioAtivo', () => {
  const base = { status: 'aberta' as const };
  it('ativo logo depois de "a caminho"', () => {
    expect(rastreioAtivo({ ...base, a_caminho_em: aCaminho(60_000) }, AGORA)).toBe(true);
  });
  it('sem "a caminho", não é ativo', () => {
    expect(rastreioAtivo(base, AGORA)).toBe(false);
  });
  it('borda das 2 horas: 1 ms antes ativo, exatamente 2 h não', () => {
    expect(rastreioAtivo({ ...base, a_caminho_em: aCaminho(LIMITE_RASTREIO_MS - 1) }, AGORA)).toBe(true);
    expect(rastreioAtivo({ ...base, a_caminho_em: aCaminho(LIMITE_RASTREIO_MS) }, AGORA)).toBe(false);
    expect(rastreioAtivo({ ...base, a_caminho_em: aCaminho(LIMITE_RASTREIO_MS + 1) }, AGORA)).toBe(false);
  });
  it('com chegada registrada, encerra', () => {
    expect(rastreioAtivo({ ...base, a_caminho_em: aCaminho(60_000), entrada_em: aCaminho(10_000) }, AGORA)).toBe(false);
  });
  it('cancelada ou finalizada, encerra', () => {
    expect(rastreioAtivo({ status: 'cancelada', a_caminho_em: aCaminho(60_000) }, AGORA)).toBe(false);
    expect(rastreioAtivo({ status: 'finalizada', a_caminho_em: aCaminho(60_000) }, AGORA)).toBe(false);
  });
  it('aceita Date do pg', () => {
    expect(rastreioAtivo({ ...base, a_caminho_em: new Date(AGORA - 1000) as unknown as string }, AGORA)).toBe(true);
  });
  it('data inválida não ativa', () => {
    expect(rastreioAtivo({ ...base, a_caminho_em: 'lixo' }, AGORA)).toBe(false);
  });
});

describe('estimarChegada', () => {
  it('sem destino ou sem posição, null', () => {
    expect(estimarChegada({ lat: 0, lng: 0 }, null)).toBeNull();
    expect(estimarChegada(null, { lat: 0, lng: 0 })).toBeNull();
  });
  it('mesmo ponto: mínimo 1 min, distância 0', () => {
    expect(estimarChegada({ lat: -23.55, lng: -46.63 }, { lat: -23.55, lng: -46.63 })).toEqual({ distancia_km: 0, minutos: 1 });
  });
  it('10 km em linha reta: 10 x 1,4 / 25 = 33,6 min, arredonda para 34', () => {
    const e = estimarChegada({ lat: 0, lng: 0 }, { lat: 10 / 111.195, lng: 0 });
    expect(e?.distancia_km).toBeCloseTo(10, 1);
    expect(e?.minutos).toBe(34);
  });
  it('arredonda para cima: 1 km = 3,36 min vira 4', () => {
    expect(estimarChegada({ lat: 0, lng: 0 }, { lat: 1 / 111.195, lng: 0 })?.minutos).toBe(4);
  });
});

describe('distanciaKm', () => {
  it('Sé até Paulista: cerca de 2,5 a 3 km', () => {
    const d = distanciaKm({ lat: -23.5505, lng: -46.6333 }, { lat: -23.5614, lng: -46.6559 });
    expect(d).toBeGreaterThan(2.3);
    expect(d).toBeLessThan(3.2);
  });
});

describe('posicaoVelha', () => {
  it('limite de 2 minutos', () => {
    expect(posicaoVelha(new Date(AGORA - POSICAO_VELHA_MS).toISOString(), AGORA)).toBe(false);
    expect(posicaoVelha(new Date(AGORA - POSICAO_VELHA_MS - 1).toISOString(), AGORA)).toBe(true);
  });
  it('sem posição não é "velha"', () => {
    expect(posicaoVelha(null, AGORA)).toBe(false);
  });
});

describe('permissões', () => {
  const os = { condominio_id: 'c1', tecnico_id: 't1' };
  it('gestor e secretária leem qualquer OS', () => {
    expect(podeLerRastreio({ id: 'a', role: 'admin' }, os)).toBe(true);
    expect(podeLerRastreio({ id: 's', role: 'secretaria' }, os)).toBe(true);
  });
  it('síndico só do próprio condomínio', () => {
    expect(podeLerRastreio({ id: 'x', role: 'sindico' }, os, 'c1')).toBe(true);
    expect(podeLerRastreio({ id: 'x', role: 'sindico' }, os, 'c2')).toBe(false);
    expect(podeLerRastreio({ id: 'x', role: 'sindico' }, os, null)).toBe(false);
    expect(podeLerRastreio({ id: 'x', role: 'sindico' }, os)).toBe(false);
  });
  it('técnico só a OS dele', () => {
    expect(podeLerRastreio({ id: 't1', role: 'tecnico' }, os)).toBe(true);
    expect(podeLerRastreio({ id: 't2', role: 'tecnico' }, os)).toBe(false);
    expect(podeLerRastreio({ id: 't1', role: 'tecnico' }, { condominio_id: 'c1' })).toBe(false);
  });
  it('papel desconhecido é negado', () => {
    expect(podeLerRastreio({ id: 't1', role: 'outro' as never }, os)).toBe(false);
  });
  it('envio: só o técnico da OS', () => {
    expect(podeEnviarPosicao({ id: 't1', role: 'tecnico' }, os)).toBe(true);
    expect(podeEnviarPosicao({ id: 't2', role: 'tecnico' }, os)).toBe(false);
    expect(podeEnviarPosicao({ id: 'a', role: 'admin' }, os)).toBe(false);
    expect(podeEnviarPosicao({ id: 'x', role: 'sindico' }, os)).toBe(false);
  });
  it('mapa geral: só o escritório', () => {
    expect(podeVerMapaGeral('admin')).toBe(true);
    expect(podeVerMapaGeral('secretaria')).toBe(true);
    expect(podeVerMapaGeral('tecnico')).toBe(false);
    expect(podeVerMapaGeral('sindico')).toBe(false);
  });
});

describe('coordenadas', () => {
  it('validação de limites', () => {
    expect(coordenadaValida(-23.5, -46.6)).toBe(true);
    expect(coordenadaValida(91, 0)).toBe(false);
    expect(coordenadaValida(0, 181)).toBe(false);
    expect(coordenadaValida('1', 2)).toBe(false);
    expect(coordenadaValida(NaN, 2)).toBe(false);
  });
  it('lerCoordenadaColada aceita "lat, lng" e links', () => {
    expect(lerCoordenadaColada('-23.550520, -46.633308')).toEqual({ lat: -23.55052, lng: -46.633308 });
    expect(lerCoordenadaColada('https://www.google.com/maps/place/X/@-23.5614,-46.6559,17z/data=abc')).toEqual({ lat: -23.5614, lng: -46.6559 });
    expect(lerCoordenadaColada('https://maps.google.com/?q=-23.5,-46.6')).toEqual({ lat: -23.5, lng: -46.6 });
    expect(lerCoordenadaColada('texto qualquer')).toBeNull();
    expect(lerCoordenadaColada('200, 300')).toBeNull();
  });
  it('chegada preenche o condomínio só com boa precisão e sem ponto prévio', () => {
    expect(chegadaPreencheCondominio({}, { precisao_m: 100 })).toBe(true);
    expect(chegadaPreencheCondominio({}, { precisao_m: 101 })).toBe(false);
    expect(chegadaPreencheCondominio({}, {})).toBe(false);
    expect(chegadaPreencheCondominio({}, null)).toBe(false);
    expect(chegadaPreencheCondominio({ lat: 1, lng: 2 }, { precisao_m: 10 })).toBe(false);
  });
});

describe('textos', () => {
  it('minutos', () => {
    expect(textoMinutos(12)).toBe('~12 min');
    expect(textoMinutos(65)).toBe('~1h05');
    expect(textoMinutos(120)).toBe('~2h');
  });
  it('há quanto tempo', () => {
    expect(textoHa(AGORA - 5_000, AGORA)).toBe('agora');
    expect(textoHa(AGORA - 3 * 60_000, AGORA)).toBe('há 3 min');
    expect(textoHa(AGORA - 125 * 60_000, AGORA)).toBe('há 2 h');
  });
});
