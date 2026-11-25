'use client';

import React from 'react';
import { Button } from './Button';
import { Select } from './Form';
import { OPCOES_POR_PAGINA, type Paginacao as PaginacaoEstado } from '@/lib/usePaginacao';

// Controle de paginação único das listas longas. Recebe o retorno de
// usePaginacao. Não aparece se a lista cabe na menor opção (10).
export function Paginacao<T>({
  p,
  rotuloItens,
  alvoRolagem,
}: {
  p: PaginacaoEstado<T>;
  rotuloItens?: string;
  alvoRolagem?: React.RefObject<HTMLElement | null>;
}) {
  if (p.total <= OPCOES_POR_PAGINA[0]) return null;

  function ir(destino: number) {
    p.irPara(destino);
    // O alvo pode ser o próprio contêiner rolável da lista ou um ponto da página.
    const alvo = alvoRolagem?.current;
    if (alvo) {
      // No celular o cabeçalho fica fixo no topo: sem esta folga, o primeiro
      // item da página nova ficaria escondido atrás dele.
      const cabecalho = document.querySelector('header');
      const fixo = cabecalho && cabecalho.getClientRects().length > 0 && getComputedStyle(cabecalho).position === 'sticky';
      if (fixo) {
        const topo = alvo.getBoundingClientRect().top + window.scrollY - cabecalho.getBoundingClientRect().height - 8;
        window.scrollTo({ top: Math.max(0, topo), behavior: 'smooth' });
      } else {
        alvo.scrollTo?.({ top: 0, behavior: 'smooth' });
        alvo.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }
  }

  const unico = p.totalPaginas <= 1;
  return (
    <nav
      aria-label="Paginação"
      className="mt-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-3 min-w-0"
    >
      <p className="text-xs text-amx-muted min-w-0">
        Mostrando {p.inicio}–{p.fim} de {p.total}
        {rotuloItens ? ` ${rotuloItens}` : ''}
      </p>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 min-w-0">
        <label className="flex items-center gap-2 text-xs text-amx-muted">
          Por página
          <Select
            value={p.porPagina}
            onChange={(e) => p.setPorPagina(Number(e.target.value))}
            className="max-sm:min-h-11"
          >
            {OPCOES_POR_PAGINA.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </Select>
        </label>
        {!unico && (
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              className="max-sm:min-h-11"
              disabled={p.pagina <= 1}
              onClick={() => ir(p.pagina - 1)}
            >
              Anterior
            </Button>
            <span className="text-xs text-amx-muted whitespace-nowrap">
              Página {p.pagina} de {p.totalPaginas}
            </span>
            <Button
              type="button"
              variant="secondary"
              className="max-sm:min-h-11"
              disabled={p.pagina >= p.totalPaginas}
              onClick={() => ir(p.pagina + 1)}
            >
              Próxima
            </Button>
          </div>
        )}
      </div>
    </nav>
  );
}
