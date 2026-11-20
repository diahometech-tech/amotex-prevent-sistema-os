// Meta de visitas preventivas por técnico por dia (Dm, 20/11). Guardada em
// `configuracao` (chave `visitas_por_tecnico_dia`); o gestor e a secretária
// ajustam na tela de Rotas. Servidor (lê o banco).
import { Database } from './db';

export const CHAVE_META_VISITAS = 'visitas_por_tecnico_dia';
export const META_VISITAS_PADRAO = 5;
export const META_VISITAS_MIN = 1;
export const META_VISITAS_MAX = 20;

/** Valida a meta recebida: inteiro de 1 a 20; qualquer outra coisa = undefined. */
export function normalizarMetaVisitas(valor: unknown): number | undefined {
  const n = typeof valor === 'string' && valor.trim() !== '' ? Number(valor) : valor;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < META_VISITAS_MIN || n > META_VISITAS_MAX) return undefined;
  return n;
}

export async function lerMetaVisitas(): Promise<number> {
  const bruto = await Database.getConfiguracao(CHAVE_META_VISITAS);
  return (bruto ? normalizarMetaVisitas(bruto) : undefined) ?? META_VISITAS_PADRAO;
}
