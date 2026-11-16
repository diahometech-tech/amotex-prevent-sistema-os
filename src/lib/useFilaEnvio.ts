'use client';

import { useEffect, useState } from 'react';
import { listarFila, ouvirFila, type ItemFila } from './fila-envio';

// Itens da fila de envio offline (src/lib/fila-envio.ts), atualizados a cada
// mudança. Com `osId`, só os daquela OS.
export function useFilaEnvio(osId?: string): ItemFila[] {
  const [itens, setItens] = useState<ItemFila[]>([]);
  useEffect(() => {
    let vivo = true;
    const recarregar = () => {
      listarFila()
        .then((lista) => {
          if (vivo) setItens(osId ? lista.filter((i) => i.os_id === osId) : lista);
        })
        .catch(() => {});
    };
    recarregar();
    const sair = ouvirFila((e) => {
      if (e.tipo === 'mudou') recarregar();
    });
    return () => {
      vivo = false;
      sair();
    };
  }, [osId]);
  return itens;
}
