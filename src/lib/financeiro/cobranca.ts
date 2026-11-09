// Regras das cobranças mensais — puras, sem I/O. Mesma lógica da planilha
// "Controle de Cobranças Amotex Preventivas", agora dentro do sistema:
// - valor do mês = valor mensal do contrato + ajustes temporários ativos
//   naquela competência (ex.: quadros elétricos set–nov);
// - vencimento = dia de vencimento do condomínio (padrão 10, como a planilha);
// - "atrasada" não é gravado: é derivado do vencimento.
import type { AjusteValor, Cobranca, CobrancaStatus, Condominio } from '../db';

export const DIA_VENCIMENTO_PADRAO = 10;

export type StatusEfetivo = CobrancaStatus | 'atrasada';

export const STATUS_LABEL: Record<StatusEfetivo, string> = {
  pendente: 'Pendente',
  enviada: 'Cobrança enviada',
  paga: 'Paga',
  isenta: 'Isenta',
  atrasada: 'Atrasada',
};

export const FORMAS_PAGAMENTO = [
  ['pix', 'PIX'], ['boleto', 'Boleto'], ['ted', 'TED'], ['transferencia', 'Transferência'],
  ['dinheiro', 'Dinheiro'], ['cheque', 'Cheque'],
] as const;

const COMPETENCIA = /^\d{4}-(0[1-9]|1[0-2])$/;
export function competenciaValida(v: unknown): v is string {
  return typeof v === 'string' && COMPETENCIA.test(v);
}

export function somarMeses(competencia: string, n: number): string {
  const [a, m] = competencia.split('-').map(Number);
  const d = new Date(Date.UTC(a, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const MESES_LONGOS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
export function rotuloCompetencia(c: string, longo = false): string {
  const [a, m] = c.split('-').map(Number);
  return longo ? `${MESES_LONGOS[m - 1]}/${a}` : `${MESES[m - 1]}/${String(a).slice(2)}`;
}

export function vencimentoDaCompetencia(competencia: string, dia?: number): string {
  const d = Math.min(Math.max(dia || DIA_VENCIMENTO_PADRAO, 1), 28);
  return `${competencia}-${String(d).padStart(2, '0')}`;
}

export function ajustesDaCompetencia(ajustes: AjusteValor[], condominioId: string, competencia: string): AjusteValor[] {
  return ajustes.filter((a) => a.condominio_id === condominioId && a.inicio <= competencia && competencia <= a.fim);
}

export function condominioAtivo(c: Pick<Condominio, 'ativo'>): boolean {
  return c.ativo !== false;
}

export function statusEfetivo(c: Pick<Cobranca, 'status' | 'vencimento'>, hoje: string): StatusEfetivo {
  if ((c.status === 'pendente' || c.status === 'enviada') && c.vencimento < hoje) return 'atrasada';
  return c.status;
}

export interface ItemCobrancaNova {
  condominio_id: string;
  competencia: string;
  valor_previsto_centavos: number;
  vencimento: string;
  observacao?: string;
}

export interface ResultadoGeracao {
  novas: ItemCobrancaNova[];
  jaExistiam: number;
  /** Ativos sem valor mensal cadastrado — não dá pra cobrar. */
  semValor: { id: string; nome: string }[];
}

// Gera as cobranças de uma competência. Idempotente: quem já tem cobrança no
// mês fica de fora (gerar de novo depois de cadastrar um condomínio novo só
// acrescenta o novo). Condomínio inativo ou com contrato que começa depois do
// mês não entra.
export function gerarCobrancasMes({
  competencia,
  condominios,
  ajustes,
  existentes,
}: {
  competencia: string;
  condominios: Condominio[];
  ajustes: AjusteValor[];
  existentes: Pick<Cobranca, 'condominio_id' | 'competencia'>[];
}): ResultadoGeracao {
  const ja = new Set(existentes.filter((c) => c.competencia === competencia).map((c) => c.condominio_id));
  const r: ResultadoGeracao = { novas: [], jaExistiam: ja.size, semValor: [] };
  for (const c of condominios) {
    if (!condominioAtivo(c) || ja.has(c.id)) continue;
    if (c.contrato_inicio && c.contrato_inicio.slice(0, 7) > competencia) continue;
    if (!c.valor_mensal_centavos) {
      r.semValor.push({ id: c.id, nome: c.nome });
      continue;
    }
    const doMes = ajustesDaCompetencia(ajustes, c.id, competencia);
    const extra = doMes.reduce((acc, a) => acc + a.valor_centavos, 0);
    r.novas.push({
      condominio_id: c.id,
      competencia,
      valor_previsto_centavos: Math.max(0, c.valor_mensal_centavos + extra),
      vencimento: vencimentoDaCompetencia(competencia, c.dia_vencimento),
      observacao: doMes.length ? doMes.map((a) => a.descricao).join('; ') : undefined,
    });
  }
  return r;
}

export interface ResumoMes {
  previsto: number;
  recebido: number;
  emAberto: number;
  atrasadoValor: number;
  pagas: number;
  pendentes: number; // pendente + enviada, ainda no prazo
  atrasadas: number;
  isentas: number;
  total: number;
  percentualRecebido: number; // 0..1
}

// Mesmos números do topo de cada aba mensal da planilha. Isenta sai do
// previsto (não é dinheiro a receber).
export function resumoMes(cobrancas: Cobranca[], hoje: string): ResumoMes {
  const r: ResumoMes = {
    previsto: 0, recebido: 0, emAberto: 0, atrasadoValor: 0,
    pagas: 0, pendentes: 0, atrasadas: 0, isentas: 0, total: cobrancas.length, percentualRecebido: 0,
  };
  for (const c of cobrancas) {
    const st = statusEfetivo(c, hoje);
    if (st === 'isenta') { r.isentas++; continue; }
    r.previsto += c.valor_previsto_centavos;
    r.recebido += c.valor_recebido_centavos ?? 0;
    if (st === 'paga') r.pagas++;
    else if (st === 'atrasada') { r.atrasadas++; r.atrasadoValor += c.valor_previsto_centavos - (c.valor_recebido_centavos ?? 0); }
    else r.pendentes++;
  }
  r.emAberto = Math.max(0, r.previsto - r.recebido);
  r.percentualRecebido = r.previsto ? r.recebido / r.previsto : 0;
  return r;
}

/** Nome padrão do comprovante, igual à regra da planilha: "001 - Gaivotas - 11-2026". */
export function nomeComprovante(nomeCondominio: string, competencia: string): string {
  const curto = nomeCondominio
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/^(condominio|cond\.?)\s+(edificio|residencial|ed\.?)?\s*/i, '')
    .replace(/[\\/:*?"<>|]/g, '')
    .trim();
  const [a, m] = competencia.split('-');
  return `${curto} - ${m}-${a}`;
}
