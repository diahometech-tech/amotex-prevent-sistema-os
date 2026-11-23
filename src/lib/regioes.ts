// Regiões dos condomínios (Grupo 3, 22/11) — função pura, sem I/O, usada no
// cadastro (sugestão pelo CEP), no planejamento mensal, na reorganização das
// sobras e na rota do dia (agrupar o que fica perto).
//
// Lista fixa: a ordem daqui é a ordem em que os grupos aparecem. Condomínio
// sem região vem sempre por último.

export const REGIOES = ['Centro', 'Zona Norte', 'Zona Sul', 'Zona Leste', 'Zona Oeste', 'Grande SP', 'Outra'] as const;
export type Regiao = (typeof REGIOES)[number];

/** Posição da região na ordem de exibição; sem região = depois de todas. */
export function ordemRegiao(regiao?: string | null): number {
  const i = REGIOES.indexOf((regiao ?? '') as Regiao);
  return i === -1 ? REGIOES.length : i;
}

/** Valida o que veio do formulário/planilha: devolve a região da lista (sem importar caixa/acento) ou undefined. */
export function normalizarRegiao(valor: unknown): Regiao | undefined {
  if (typeof valor !== 'string') return undefined;
  const chave = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  const alvo = chave(valor);
  return REGIOES.find((r) => chave(r) === alvo);
}

/**
 * Região sugerida pelo CEP. Faixas da capital paulista (Correios):
 *   01000-000 a 01999-999  Centro
 *   02000-000 a 02999-999  Zona Norte
 *   03000-000 a 03999-999  Zona Leste
 *   04000-000 a 04999-999  Zona Sul
 *   05000-000 a 05999-999  Zona Oeste
 *   08000-000 a 08499-999  Zona Leste (Itaquera, São Miguel, Guaianases)
 * Demais faixas de SP são Grande SP: 06 e 07 (Osasco, Barueri, Guarulhos…),
 * 08500-000 em diante (Ferraz, Poá, Itaquaquecetuba…) e 09 (ABC). CEP fora
 * do estado de São Paulo (prefixo 10 em diante) = "Outra". É só uma sugestão:
 * quem cadastra pode trocar (ex.: parte do prefixo 01 já é Zona Oeste).
 * CEP que não tem 8 dígitos = sem sugestão (undefined).
 */
export function regiaoPorCep(cep?: string | null): Regiao | undefined {
  const d = (cep ?? '').replace(/\D/g, '');
  if (d.length !== 8) return undefined;
  const prefixo = Number(d.slice(0, 2));
  switch (prefixo) {
    case 1: return 'Centro';
    case 2: return 'Zona Norte';
    case 3: return 'Zona Leste';
    case 4: return 'Zona Sul';
    case 5: return 'Zona Oeste';
    case 6:
    case 7:
    case 9: return 'Grande SP';
    case 8: return Number(d.slice(0, 5)) < 8500 ? 'Zona Leste' : 'Grande SP';
    default: return 'Outra';
  }
}

export interface PontoGeografico {
  nome: string;
  regiao?: string | null;
  cep?: string | null;
}

/** Ordem geográfica: região (na ordem da lista), CEP dentro dela, nome por último. Sem região/CEP = no fim do grupo. */
export function compararGeografico(a: PontoGeografico, b: PontoGeografico): number {
  const dr = ordemRegiao(a.regiao) - ordemRegiao(b.regiao);
  if (dr !== 0) return dr;
  const ca = (a.cep ?? '').replace(/\D/g, '') || '99999999';
  const cb = (b.cep ?? '').replace(/\D/g, '') || '99999999';
  return ca.localeCompare(cb) || a.nome.localeCompare(b.nome, 'pt-BR');
}
