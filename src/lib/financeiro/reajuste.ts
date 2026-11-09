// Reajuste anual de contrato — puro, sem I/O.
//
// Dor relatada pelos donos (reunião de 26/10): contratos têm cláusula de
// reajuste (IGP-M etc.), mas ninguém lembrava do aniversário — tem contrato
// fechado a R$ 410 que nunca foi reajustado, e a estimativa é de dezenas de
// milhares de reais por ano deixados na mesa. Aqui: o sistema sabe o
// aniversário de cada contrato, avisa 30 dias antes, sugere o % (índice do
// contrato ou % fixo) e o gestor decide — pode mudar o %, adiar ("no ano que
// vem"), ou registrar recusa.
import type { Condominio, IndiceReajuste, Reajuste } from '../db';
import { aplicarPercentual, formatarReais } from './dinheiro';
import { condominioAtivo, rotuloCompetencia, somarMeses } from './cobranca';

export const JANELA_AVISO_DIAS = 30;

export const INDICE_LABEL: Record<IndiceReajuste, string> = {
  igpm: 'IGP-M',
  ipca: 'IPCA',
  inpc: 'INPC',
  fixo: '% fixo',
};

export const REAJUSTE_STATUS_LABEL: Record<Reajuste['status'], string> = {
  pendente: 'A enviar',
  enviado: 'Aviso enviado',
  aceito: 'Aplicado',
  recusado: 'Recusado',
  adiado: 'Adiado',
};

function dataNoAno(inicio: string, ano: number): string {
  const [, m, d] = inicio.split('-').map(Number);
  // 29/02 em ano não bissexto vira 28/02.
  const ultimoDia = new Date(Date.UTC(ano, m, 0)).getUTCDate();
  return `${ano}-${String(m).padStart(2, '0')}-${String(Math.min(d, ultimoDia)).padStart(2, '0')}`;
}

/** Último aniversário já ocorrido (>= 1 ano de contrato), ou null. */
export function ultimoAniversario(inicio: string, hoje: string): string | null {
  const anoInicio = Number(inicio.slice(0, 4));
  let ano = Number(hoje.slice(0, 4));
  let d = dataNoAno(inicio, ano);
  if (d > hoje) d = dataNoAno(inicio, --ano);
  return ano > anoInicio ? d : null;
}

/** Próximo aniversário depois de hoje. */
export function proximoAniversario(inicio: string, hoje: string): string {
  const anoInicio = Number(inicio.slice(0, 4));
  let ano = Math.max(Number(hoje.slice(0, 4)), anoInicio + 1);
  let d = dataNoAno(inicio, ano);
  if (d <= hoje) d = dataNoAno(inicio, ++ano);
  return d;
}

export function diasEntre(de: string, ate: string): number {
  return Math.round((Date.parse(`${ate}T00:00:00Z`) - Date.parse(`${de}T00:00:00Z`)) / 86_400_000);
}

export interface ReajustePendente {
  condominio_id: string;
  nome: string;
  aniversario: string;
  /** Negativo = aniversário já passou sem reajuste registrado. */
  dias: number;
  valor_atual_centavos: number;
  indice?: IndiceReajuste;
  anosDeContrato: number;
}

// Contratos que pedem ação: aniversário nos próximos 30 dias, ou o último
// aniversário já passou e ninguém registrou o reajuste daquele ciclo (o
// "dinheiro deixado na mesa"). Se o próximo já está dentro da janela, ele
// vence o ciclo perdido — um reajuste agora resolve os dois. Ciclo com
// reajuste registrado (qualquer status) sai da lista — o acompanhamento passa
// pra lista de reajustes registrados.
export function reajustesPendentes(
  condominios: Condominio[],
  registrados: Pick<Reajuste, 'condominio_id' | 'aniversario'>[],
  hoje: string,
  janela = JANELA_AVISO_DIAS
): ReajustePendente[] {
  const feitos = new Set(registrados.map((r) => `${r.condominio_id}|${r.aniversario}`));
  const out: ReajustePendente[] = [];
  for (const c of condominios) {
    if (!condominioAtivo(c) || !c.contrato_inicio || !c.valor_mensal_centavos) continue;
    const proximo = proximoAniversario(c.contrato_inicio, hoje);
    const candidatos = diasEntre(hoje, proximo) <= janela ? [proximo] : [ultimoAniversario(c.contrato_inicio, hoje)];
    for (const aniv of candidatos) {
      if (!aniv || feitos.has(`${c.id}|${aniv}`)) continue;
      const dias = diasEntre(hoje, aniv);
      if (dias > janela) continue;
      out.push({
        condominio_id: c.id,
        nome: c.nome,
        aniversario: aniv,
        dias,
        valor_atual_centavos: c.valor_mensal_centavos,
        indice: c.reajuste_indice,
        anosDeContrato: Number(aniv.slice(0, 4)) - Number(c.contrato_inicio.slice(0, 4)),
      });
      break; // um ciclo por vez: o vencido primeiro
    }
  }
  return out.sort((a, b) => a.dias - b.dias);
}

/** % sugerido: % fixo do contrato, ou o índice acumulado em 12 meses. */
export function percentualSugerido(
  c: Pick<Condominio, 'reajuste_indice' | 'reajuste_percentual_fixo'>,
  indices: Partial<Record<IndiceReajuste, number>>
): number | null {
  if (c.reajuste_indice === 'fixo') return c.reajuste_percentual_fixo ?? null;
  if (c.reajuste_indice && indices[c.reajuste_indice] !== undefined) return indices[c.reajuste_indice]!;
  return null;
}

/** Acumulado de uma série mensal (% ao mês) → % no período. */
export function acumular(percentuaisMensais: number[]): number {
  const fator = percentuaisMensais.reduce((acc, p) => acc * (1 + p / 100), 1);
  return Math.round((fator - 1) * 10_000) / 100;
}

/**
 * Mês em que o reajuste passa a valer, por padrão: o mês do aniversário, ou
 * — se o ciclo já passou (reajuste esquecido) — o mês seguinte a hoje. Nunca
 * retroativo: o aviso diria "a partir de junho" em outubro.
 */
export function vigenciaPadrao(aniversario: string, hoje: string): string {
  const mesAniv = aniversario.slice(0, 7);
  const mesHoje = hoje.slice(0, 7);
  return mesAniv >= mesHoje ? mesAniv : somarMeses(mesHoje, 1);
}

export function calcularValorNovo(valorAtual: number, percentual: number): number {
  return aplicarPercentual(valorAtual, percentual);
}

function fmtPct(p: number): string {
  return `${p.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
}

function fmtData(iso: string): string {
  const [a, m, d] = iso.split('-');
  return `${d}/${m}/${a}`;
}

export interface AvisoReajuste {
  assunto: string;
  texto: string; // e-mail (texto puro)
  whatsapp: string;
}

// Texto do aviso ao condomínio. Tom de comunicado, com a cláusula como base e
// porta aberta pra conversa — é o que os donos descreveram ("em caso de
// dúvidas entre em contato").
export function textoAvisoReajuste(r: {
  nomeCondominio: string;
  responsavel?: string;
  aniversario: string;
  vigencia: string;
  indice?: IndiceReajuste;
  percentual: number;
  valorAtual: number;
  valorNovo: number;
}): AvisoReajuste {
  const base = r.indice && r.indice !== 'fixo' ? `pelo ${INDICE_LABEL[r.indice]} acumulado dos últimos 12 meses` : 'conforme o percentual previsto em contrato';
  const saudacao = r.responsavel ? `Olá, ${r.responsavel}.` : 'Olá.';
  const corpo = [
    saudacao,
    '',
    `Em ${fmtData(r.aniversario)} o contrato de manutenção preventiva do ${r.nomeCondominio} com a Amotex completa mais um ano. ` +
      `Como previsto na cláusula de reajuste, o valor mensal será atualizado ${base} (${fmtPct(r.percentual)}).`,
    '',
    `Valor atual: ${formatarReais(r.valorAtual)}`,
    `Novo valor: ${formatarReais(r.valorNovo)}`,
    `A partir da cobrança de ${rotuloCompetencia(r.vigencia, true)}.`,
    '',
    'Em caso de dúvida, é só responder esta mensagem ou falar com a gente.',
    '',
    'Equipe Amotex Prevent',
  ].join('\n');
  return {
    assunto: `Reajuste anual do contrato — ${r.nomeCondominio}`,
    texto: corpo,
    whatsapp: corpo.replace('Equipe Amotex Prevent', '*Equipe Amotex Prevent*'),
  };
}
