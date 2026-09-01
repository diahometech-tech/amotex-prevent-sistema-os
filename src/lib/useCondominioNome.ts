'use client';

import { useMemo } from 'react';
import type { Condominio } from './db';

// Resolve o nome do condomínio a partir do id. Estava reimplementado de
// forma idêntica em src/app/page.tsx, rotas/page.tsx e dashboard/page.tsx
// (issue #13) — extraído pra um lugar só depois que a terceira cópia
// apareceu, pra não arriscar as três divergirem num ajuste futuro (ex.: o
// fallback quando o id não bate com nenhum condomínio carregado).
export function useCondominioNome(condominios: Condominio[]) {
  return useMemo(() => {
    const map = new Map(condominios.map((c) => [c.id, c.nome]));
    return (id: string) => map.get(id) || 'Condomínio desconhecido';
  }, [condominios]);
}
