import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { estadoPermissaoLocalizacao, pedirLocalizacao } from '../src/lib/localizacao-cliente';

function instalar(nav: Record<string, unknown>) {
  vi.stubGlobal('navigator', nav);
}

describe('pedirLocalizacao', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('ok quando o navegador entrega a posição', async () => {
    const getCurrentPosition = vi.fn((ok: (p: unknown) => void, _e?: unknown, _o?: unknown) => ok({ coords: { latitude: 1, longitude: 2, accuracy: 5 } }));
    instalar({ geolocation: { getCurrentPosition } });
    await expect(pedirLocalizacao()).resolves.toBe('ok');
    expect(getCurrentPosition.mock.calls[0][2]).toMatchObject({ enableHighAccuracy: true, timeout: 10_000 });
  });

  it('código 1 vira negada', async () => {
    instalar({ geolocation: { getCurrentPosition: (_o: unknown, err: (e: { code: number }) => void) => err({ code: 1 }) } });
    await expect(pedirLocalizacao()).resolves.toBe('negada');
  });

  it('códigos 2 e 3 viram sem_gps', async () => {
    for (const code of [2, 3]) {
      instalar({ geolocation: { getCurrentPosition: (_o: unknown, err: (e: { code: number }) => void) => err({ code }) } });
      await expect(pedirLocalizacao()).resolves.toBe('sem_gps');
    }
  });

  it('sem API de geolocalização é indisponivel', async () => {
    instalar({});
    await expect(pedirLocalizacao()).resolves.toBe('indisponivel');
  });

  it('navegador que não responde cai na rede de segurança (sem_gps)', async () => {
    instalar({ geolocation: { getCurrentPosition: () => {} } });
    const p = pedirLocalizacao();
    await vi.advanceTimersByTimeAsync(12_000);
    await expect(p).resolves.toBe('sem_gps');
  });
});

describe('estadoPermissaoLocalizacao', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('lê o estado quando navigator.permissions existe', async () => {
    instalar({ permissions: { query: async () => ({ state: 'denied' }) } });
    await expect(estadoPermissaoLocalizacao()).resolves.toBe('denied');
  });

  it('desconhecido onde não existe ou quebra', async () => {
    instalar({});
    await expect(estadoPermissaoLocalizacao()).resolves.toBe('desconhecido');
    instalar({ permissions: { query: async () => { throw new Error('x'); } } });
    await expect(estadoPermissaoLocalizacao()).resolves.toBe('desconhecido');
  });
});
