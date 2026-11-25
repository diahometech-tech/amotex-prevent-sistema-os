import { describe, expect, it } from 'vitest';
import {
  fatiarPagina, intervaloDaPagina, lerPorPagina, limitarPagina, OPCOES_POR_PAGINA, POR_PAGINA_PADRAO, totalDePaginas,
} from '../src/lib/usePaginacao';

describe('paginação (lógica pura)', () => {
  it('total de páginas', () => {
    expect(totalDePaginas(0, 20)).toBe(1);
    expect(totalDePaginas(20, 20)).toBe(1);
    expect(totalDePaginas(21, 20)).toBe(2);
    expect(totalDePaginas(61, 20)).toBe(4);
    expect(totalDePaginas(5, 0)).toBe(1);
  });
  it('limita a página ao intervalo existente', () => {
    expect(limitarPagina(0, 4)).toBe(1);
    expect(limitarPagina(9, 4)).toBe(4);
    expect(limitarPagina(NaN, 4)).toBe(1);
    expect(limitarPagina(2.7, 4)).toBe(2);
  });
  it('fatia a página', () => {
    const itens = Array.from({ length: 61 }, (_, i) => i + 1);
    expect(fatiarPagina(itens, 1, 20)).toHaveLength(20);
    expect(fatiarPagina(itens, 4, 20)).toEqual([61]);
    expect(fatiarPagina(itens, 99, 20)).toEqual([61]); // lista encolheu: última página
    expect(fatiarPagina([], 1, 20)).toEqual([]);
  });
  it('intervalo "Mostrando X–Y"', () => {
    expect(intervaloDaPagina(61, 2, 20)).toEqual({ inicio: 21, fim: 40 });
    expect(intervaloDaPagina(61, 4, 20)).toEqual({ inicio: 61, fim: 61 });
    expect(intervaloDaPagina(0, 1, 20)).toEqual({ inicio: 0, fim: 0 });
  });
  it('valida o por-página guardado', () => {
    expect(lerPorPagina('50')).toBe(50);
    expect(lerPorPagina(100)).toBe(100);
    expect(lerPorPagina('7')).toBe(POR_PAGINA_PADRAO);
    expect(lerPorPagina(null)).toBe(POR_PAGINA_PADRAO);
    expect(lerPorPagina('')).toBe(POR_PAGINA_PADRAO);
    expect(lerPorPagina('abc')).toBe(POR_PAGINA_PADRAO);
    expect(OPCOES_POR_PAGINA).toContain(POR_PAGINA_PADRAO);
  });
});
