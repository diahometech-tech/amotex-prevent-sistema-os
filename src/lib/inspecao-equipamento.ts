// "Inspeção dos equipamentos obrigatória", por tipo de OS. Guardada em
// `configuracao` (como a meta de visitas por dia). Decide se os itens
// "Inspecionar <equipamento>" nascem obrigatórios no checklist: valem na
// criação da OS e quando um equipamento novo entra nas OS abertas. OS já
// criadas não mudam. Servidor (lê o banco).
import { Database, type OS } from './db';

export type InspecaoObrigatoria = Record<OS['tipo'], boolean>;

export const CHAVE_INSPECAO: Record<OS['tipo'], string> = {
  preventiva: 'inspecao_obrigatoria_preventiva',
  corretiva: 'inspecao_obrigatoria_corretiva',
};

// Preventiva: a vistoria é o serviço. Corretiva: o foco é o defeito chamado.
export const INSPECAO_PADRAO: InspecaoObrigatoria = { preventiva: true, corretiva: false };

/** 'true'/'false' (como fica no banco) ou booleano; qualquer outra coisa = undefined. */
export function normalizarBooleano(valor: unknown): boolean | undefined {
  if (typeof valor === 'boolean') return valor;
  if (valor === 'true') return true;
  if (valor === 'false') return false;
  return undefined;
}

export async function lerInspecaoObrigatoria(): Promise<InspecaoObrigatoria> {
  const [preventiva, corretiva] = await Promise.all([
    Database.getConfiguracao(CHAVE_INSPECAO.preventiva),
    Database.getConfiguracao(CHAVE_INSPECAO.corretiva),
  ]);
  return {
    preventiva: normalizarBooleano(preventiva) ?? INSPECAO_PADRAO.preventiva,
    corretiva: normalizarBooleano(corretiva) ?? INSPECAO_PADRAO.corretiva,
  };
}
