// Índices de reajuste acumulados em 12 meses, da API pública do Banco Central
// (SGS, sem chave). Só servidor. Cache em memória de 12h: o índice muda uma
// vez por mês e a API do BCB é lenta às vezes. Falha não trava nada — o
// gestor digita o % na mão.
import type { IndiceReajuste } from '../db';
import { acumular } from './reajuste';

const SERIES: Record<Exclude<IndiceReajuste, 'fixo'>, number> = { igpm: 189, ipca: 433, inpc: 188 };
const TTL_MS = 12 * 3_600_000;

export interface IndicesAcumulados {
  valores: Partial<Record<IndiceReajuste, number>>;
  /** Mês do último dado (MM/AAAA) por índice. */
  referencia: Partial<Record<IndiceReajuste, string>>;
  fonte: string;
  erro?: string;
}

let cache: { em: number; dados: IndicesAcumulados } | null = null;

export async function indicesAcumulados(): Promise<IndicesAcumulados> {
  if (cache && Date.now() - cache.em < TTL_MS) return cache.dados;
  const dados: IndicesAcumulados = { valores: {}, referencia: {}, fonte: 'Banco Central (SGS), acumulado 12 meses' };
  const falhas: string[] = [];
  await Promise.all(
    Object.entries(SERIES).map(async ([indice, serie]) => {
      try {
        const res = await fetch(`https://api.bcb.gov.br/dados/serie/bcdata.sgs.${serie}/dados/ultimos/12?formato=json`, {
          signal: AbortSignal.timeout(8000),
          cache: 'no-store',
        });
        if (!res.ok) throw new Error(String(res.status));
        const linhas = (await res.json()) as { data: string; valor: string }[];
        if (!Array.isArray(linhas) || linhas.length < 12) throw new Error('série incompleta');
        dados.valores[indice as IndiceReajuste] = acumular(linhas.map((l) => Number(l.valor)));
        dados.referencia[indice as IndiceReajuste] = linhas.at(-1)!.data.slice(3);
      } catch {
        falhas.push(indice.toUpperCase());
      }
    })
  );
  if (falhas.length) dados.erro = `Não foi possível buscar ${falhas.join(', ')} no Banco Central agora.`;
  // Só cacheia resultado completo — falha tenta de novo na próxima abertura.
  if (!falhas.length) cache = { em: Date.now(), dados };
  return dados;
}
