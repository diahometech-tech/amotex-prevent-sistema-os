import { describe, it, expect } from 'vitest';
import { NOVIDADES, novidadesPara, type Novidade } from '../src/lib/novidades';

const lista: Novidade[] = [
  { id: 'a', data: '2026-11-20', titulo: 'A', itens: ['x'], perfis: ['admin', 'tecnico'] },
  { id: 'b', data: '2026-11-25', titulo: 'B', itens: ['x'], perfis: ['admin'] },
  { id: 'c', data: '2026-11-22', titulo: 'C', itens: ['x'], perfis: ['admin', 'secretaria', 'tecnico', 'sindico'] },
];

describe('novidadesPara', () => {
  it('filtra pelo perfil', () => {
    expect(novidadesPara('sindico', lista).map((n) => n.id)).toEqual(['c']);
    expect(novidadesPara('secretaria', lista).map((n) => n.id)).toEqual(['c']);
    expect(novidadesPara('tecnico', lista).map((n) => n.id)).toEqual(['c', 'a']);
  });
  it('ordena da mais recente para a mais antiga', () => {
    expect(novidadesPara('admin', lista).map((n) => n.id)).toEqual(['b', 'c', 'a']);
  });
  it('não altera a lista original', () => {
    novidadesPara('admin', lista);
    expect(lista.map((n) => n.id)).toEqual(['a', 'b', 'c']);
  });
  it('todo perfil tem ao menos uma novidade e os ids são únicos', () => {
    for (const p of ['admin', 'secretaria', 'tecnico', 'sindico'] as const) {
      expect(novidadesPara(p).length).toBeGreaterThan(0);
    }
    const ids = NOVIDADES.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
