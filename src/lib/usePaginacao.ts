'use client';

import { useState } from 'react';

// Opções de "Por página" e padrão. Compartilhado por todas as listas longas.
export const OPCOES_POR_PAGINA = [10, 20, 50, 100] as const;
export const POR_PAGINA_PADRAO = 20;

const PREFIXO_STORAGE = 'amx-por-pagina:';

// ---- Lógica pura (testável) ----

export function totalDePaginas(total: number, porPagina: number): number {
  if (!(total > 0) || !(porPagina > 0)) return 1;
  return Math.max(1, Math.ceil(total / porPagina));
}

// Mantém a página dentro de 1..totalPaginas (inclusive quando a lista encolhe).
export function limitarPagina(pagina: number, totalPag: number): number {
  if (!Number.isFinite(pagina)) return 1;
  return Math.min(Math.max(1, Math.floor(pagina)), Math.max(1, totalPag));
}

export function fatiarPagina<T>(itens: T[], pagina: number, porPagina: number): T[] {
  const p = limitarPagina(pagina, totalDePaginas(itens.length, porPagina));
  const ini = (p - 1) * porPagina;
  return itens.slice(ini, ini + porPagina);
}

// Valida o que veio do localStorage (string/número/null) contra as opções.
export function lerPorPagina(valor: unknown): number {
  const n = typeof valor === 'string' ? Number(valor.trim() === '' ? NaN : valor) : valor;
  return typeof n === 'number' && (OPCOES_POR_PAGINA as readonly number[]).includes(n) ? n : POR_PAGINA_PADRAO;
}

// "Mostrando 21–40": posições 1-based do primeiro e do último item da página.
export function intervaloDaPagina(total: number, pagina: number, porPagina: number): { inicio: number; fim: number } {
  if (total <= 0) return { inicio: 0, fim: 0 };
  const p = limitarPagina(pagina, totalDePaginas(total, porPagina));
  const inicio = (p - 1) * porPagina + 1;
  return { inicio, fim: Math.min(total, p * porPagina) };
}

// ---- localStorage (sempre protegido) ----

function carregarPorPagina(chave: string): number {
  try {
    return lerPorPagina(window.localStorage.getItem(PREFIXO_STORAGE + chave));
  } catch {
    return POR_PAGINA_PADRAO;
  }
}

function salvarPorPagina(chave: string, n: number) {
  try {
    window.localStorage.setItem(PREFIXO_STORAGE + chave, String(n));
  } catch {
    // sem localStorage: a escolha vale só nesta tela
  }
}

// ---- Hook ----

export type Paginacao<T> = {
  itensDaPagina: T[];
  pagina: number;
  totalPaginas: number;
  porPagina: number;
  total: number;
  inicio: number;
  fim: number;
  irPara: (p: number) => void;
  setPorPagina: (n: number) => void;
};

export function usePaginacao<T>(
  itens: T[],
  opcoes: { chave: string; redefinirQuando?: unknown }
): Paginacao<T> {
  const { chave, redefinirQuando } = opcoes;
  const [porPaginaEscolhido, setPorPaginaEscolhido] = useState<number>(() =>
    typeof window === 'undefined' ? POR_PAGINA_PADRAO : carregarPorPagina(chave)
  );
  // A página guarda a "marca" (filtros + tamanho) em que foi escolhida; se a
  // marca mudou, voltamos para a 1 sem precisar de efeito.
  const marca = `${String(redefinirQuando ?? '')}|${porPaginaEscolhido}`;
  const [estado, setEstado] = useState<{ pagina: number; marca: string }>({ pagina: 1, marca });

  const total = itens.length;
  const totalPaginas = totalDePaginas(total, porPaginaEscolhido);
  const pagina = limitarPagina(estado.marca === marca ? estado.pagina : 1, totalPaginas);
  const { inicio, fim } = intervaloDaPagina(total, pagina, porPaginaEscolhido);

  const irPara = (p: number) => setEstado({ pagina: limitarPagina(p, totalPaginas), marca });
  const setPorPagina = (n: number) => {
    const v = lerPorPagina(n);
    setPorPaginaEscolhido(v);
    salvarPorPagina(chave, v);
  };

  return {
    itensDaPagina: fatiarPagina(itens, pagina, porPaginaEscolhido),
    pagina,
    totalPaginas,
    porPagina: porPaginaEscolhido,
    total,
    inicio,
    fim,
    irPara,
    setPorPagina,
  };
}
