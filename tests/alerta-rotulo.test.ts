import { describe, expect, it } from 'vitest';
import { deParaResolvido, rotuloAlerta } from '../src/lib/alerta-rotulo';

const res = { nome_interno: 'Caixa Norte' };
const cond = { nome: 'Edifício Aurora' };

describe('rotuloAlerta / deParaResolvido', () => {
  it('ambos resolvidos', () => {
    const a = { reservatorio: res, condominio: cond };
    expect(deParaResolvido(a)).toBe(true);
    expect(rotuloAlerta(a)).toBe('Edifício Aurora · Caixa Norte');
  });
  it('só reservatório', () => {
    const a = { reservatorio: res, condominio: null };
    expect(deParaResolvido(a)).toBe(false);
    expect(rotuloAlerta(a)).toBe('Caixa Norte · condomínio não identificado');
  });
  it('nenhum', () => {
    const a = { reservatorio: null, condominio: null };
    expect(deParaResolvido(a)).toBe(false);
    expect(rotuloAlerta(a)).toBe('Reservatório não identificado');
  });
});
