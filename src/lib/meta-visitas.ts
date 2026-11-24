// Meta de visitas preventivas por técnico por dia (Dm, 20/11). Guardada em
// `configuracao` (chave `visitas_por_tecnico_dia`); o gestor e a secretária
// ajustam na tela de Rotas. Servidor (lê o banco).
import { Database } from './db';
import { diasUteisPreventiva } from './os-agenda';

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

// "Planejar preventivas aos sábados" (padrão: não; domingo nunca). Vale para o
// planejamento mensal, a reorganização das sobras e o "próximo dia útil".
export const CHAVE_PLANEJAR_SABADO = 'planejar_sabado';

export async function lerPlanejarSabado(): Promise<boolean> {
  return (await Database.getConfiguracao(CHAVE_PLANEJAR_SABADO)) === '1';
}

/** Dias da semana (0 = domingo) em que a preventiva é agendada, conforme a configuração. */
export async function lerDiasUteisPreventiva(): Promise<readonly number[]> {
  return diasUteisPreventiva(await lerPlanejarSabado());
}

export async function lerMetaVisitas(): Promise<number> {
  const bruto = await Database.getConfiguracao(CHAVE_META_VISITAS);
  return (bruto ? normalizarMetaVisitas(bruto) : undefined) ?? META_VISITAS_PADRAO;
}
