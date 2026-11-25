import { describe, it, expect } from 'vitest';
import { novidadesPara, type Novidade } from '../src/lib/novidades';

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
  it('a novidade provisória do app vale para todos os perfis', () => {
    for (const p of ['admin', 'secretaria', 'tecnico', 'sindico'] as const) {
      expect(novidadesPara(p).length).toBeGreaterThan(0);
    }
  });
});
