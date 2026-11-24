'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export const INTERVALO_CONSULTA_MS = 15_000;

/**
 * Consulta `url` a cada 15 s, só com a aba visível (e uma vez ao voltar para
 * ela). Devolve o último JSON bom; erro de rede mantém o dado anterior.
 */
export function useConsultaPeriodica<T>(url: string | null): { dados: T | null; carregou: boolean; erro: boolean; recarregar: () => void } {
  const [dados, setDados] = useState<T | null>(null);
  const [carregou, setCarregou] = useState(false);
  const [erro, setErro] = useState(false);
  const emVoo = useRef(false);

  const buscar = useCallback(async () => {
    if (!url || emVoo.current) return;
    emVoo.current = true;
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (res.ok) {
        setDados((await res.json()) as T);
        setErro(false);
      } else {
        setErro(true);
      }
    } catch {
      setErro(true);
    } finally {
      emVoo.current = false;
      setCarregou(true);
    }
  }, [url]);

  useEffect(() => {
    if (!url) return;
    const visivel = () => document.visibilityState === 'visible';
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (visivel()) void buscar();
    const t = setInterval(() => {
      if (visivel()) void buscar();
    }, INTERVALO_CONSULTA_MS);
    const aoVoltar = () => {
      if (visivel()) void buscar();
    };
    document.addEventListener('visibilitychange', aoVoltar);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', aoVoltar);
    };
  }, [url, buscar]);

  return { dados, carregou, erro, recarregar: () => void buscar() };
}
