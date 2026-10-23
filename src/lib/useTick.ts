'use client';

import { useEffect, useState } from 'react';

// Re-renderiza a cada `ms` — pra contagem do prazo de chegada da corretiva
// ("faltam 1h20") andar sozinha com a tela aberta, sem recarregar.
export function useTick(ms = 60_000): number {
  const [agora, setAgora] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setAgora(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return agora;
}
