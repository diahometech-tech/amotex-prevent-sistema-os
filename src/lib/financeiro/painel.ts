// Painel financeiro — agregações puras pro dashboard do gestor.
// Só RECEITA (decisão da reunião de 26/10: "o que eu queria era acompanhar o
// crescimento do faturamento"); contas a pagar ficam fora.
import type { Cobranca, Condominio } from '../db';
import { condominioAtivo, resumoMes, somarMeses, type ResumoMes } from './cobranca';
import { hojeISO } from '../os-agenda';

export interface MesFinanceiro extends ResumoMes {
  competencia: string;
}

export function serieMensal(cobrancas: Cobranca[], competencias: string[], hoje: string): MesFinanceiro[] {
  return competencias.map((competencia) => ({
    competencia,
    ...resumoMes(cobrancas.filter((c) => c.competencia === competencia), hoje),
  }));
}

export function ultimasCompetencias(atual: string, n: number): string[] {
  return Array.from({ length: n }, (_, i) => somarMeses(atual, i - n + 1));
}

/** Data em que o condomínio entrou na carteira: início do contrato, ou o cadastro. */
export function entradaNaCarteira(c: Pick<Condominio, 'contrato_inicio' | 'criado_em'>): string {
  if (c.contrato_inicio) return c.contrato_inicio;
  // criado_em é TIMESTAMPTZ: no Postgres o driver entrega Date, não string
  // (o tipo diz string porque é o que chega ao cliente via JSON). Converte
  // pro dia no fuso da operação.
  return hojeISO(new Date(c.criado_em));
}

export interface PontoCarteira {
  competencia: string;
  ativos: number;
  novos: number;
  saidas: number;
  receitaMensal: number; // soma dos contratos ativos no fim do mês (valor atual)
}

// Carteira mês a mês: ativo no fim da competência = entrou até o fim do mês e
// não saiu até lá. Receita usa o valor ATUAL do contrato (não há histórico de
// valor) — é uma aproximação, dita no painel.
export function evolucaoCarteira(condominios: Condominio[], competencias: string[]): PontoCarteira[] {
  return competencias.map((competencia) => {
    const fim = `${competencia}-31`;
    let ativos = 0, novos = 0, saidas = 0, receitaMensal = 0;
    for (const c of condominios) {
      const entrada = entradaNaCarteira(c);
      const saida = !condominioAtivo(c) ? (c.desativado_em || '0000-00-00') : null;
      if (entrada.slice(0, 7) === competencia) novos++;
      if (saida && saida.slice(0, 7) === competencia) saidas++;
      if (entrada <= fim && (!saida || saida > fim)) {
        ativos++;
        receitaMensal += c.valor_mensal_centavos ?? 0;
      }
    }
    return { competencia, ativos, novos, saidas, receitaMensal };
  });
}

export interface Projecao {
  meta: number;
  ativosHoje: number;
  /** Média de entradas líquidas por mês na janela observada. */
  ritmoMensal: number;
  /** Meses até a meta no ritmo atual (null se o ritmo for <= 0). */
  mesesAteMeta: number | null;
  competenciaMeta: string | null;
  /** Ritmo necessário pra bater a meta até `prazo`. */
  ritmoNecessario: number | null;
  prazo: string; // YYYY-MM
}

export function projetarMeta(pontos: PontoCarteira[], meta: number, prazo: string): Projecao {
  const ativosHoje = pontos.at(-1)?.ativos ?? 0;
  const janela = pontos.slice(-6);
  const ritmoMensal = janela.length > 1 ? (janela.at(-1)!.ativos - janela[0].ativos) / (janela.length - 1) : 0;
  const falta = Math.max(0, meta - ativosHoje);
  const atual = pontos.at(-1)?.competencia ?? prazo;
  const mesesAtePrazo = Math.max(0, (Number(prazo.slice(0, 4)) - Number(atual.slice(0, 4))) * 12 + Number(prazo.slice(5)) - Number(atual.slice(5)));
  const mesesAteMeta = falta === 0 ? 0 : ritmoMensal > 0 ? Math.ceil(falta / ritmoMensal) : null;
  return {
    meta,
    ativosHoje,
    ritmoMensal: Math.round(ritmoMensal * 10) / 10,
    mesesAteMeta,
    competenciaMeta: mesesAteMeta === null ? null : somarMeses(atual, mesesAteMeta),
    ritmoNecessario: mesesAtePrazo > 0 ? Math.round((falta / mesesAtePrazo) * 10) / 10 : null,
    prazo,
  };
}
