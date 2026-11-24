// Capacidade da equipe de preventiva (gestor, Dashboard) — função pura, sem I/O.
//
// Responde: quantos condomínios cabem com a equipe de hoje, e de quantos
// técnicos a carteira de N condomínios (meta da carteira) precisaria.
//
// Conta:
//  - média real = visitas preventivas CONCLUÍDAS por técnico por dia útil, nas
//    últimas 4 e 8 semanas (a conclusão é a saída da OS; sem ela, a chegada;
//    sem as duas, o dia agendado). Só técnicos do planejamento (a equipe atual);
//  - visitas necessárias por mês = soma de `preventivas_por_mes` dos condomínios
//    ativos;
//  - capacidade do mês = técnicos × (média real das últimas 4 semanas; sem
//    dado, a das 8; sem nenhum, a META de visitas por técnico/dia) × dias úteis
//    do mês;
//  - cabem X condomínios = capacidade ÷ visitas por condomínio (média da carteira);
//  - para N condomínios = ceil(N × visitas por condomínio ÷ (média × dias úteis do mês)).
// "Poucos dados": menos de 2 semanas de histórico de visitas concluídas — a
// média ainda não é confiável (o gráfico avisa).
import type { OS } from './db';
import { DIAS_UTEIS_PREVENTIVA, ehDiaUtil, hojeISO, somarDias } from './os-agenda';
import { diasDoMes, normalizarFrequencia } from './planejamento-preventiva';

export const SEMANAS_HISTORICO = 8;
/** Abaixo disto (em dias de histórico) a média é marcada como pouco confiável. */
export const DIAS_MIN_HISTORICO = 14;

export interface SemanaCapacidade {
  /** Primeiro dia do bloco de 7 dias (YYYY-MM-DD). */
  inicio: string;
  /** Visitas preventivas concluídas no bloco. */
  concluidas: number;
  /** Dias úteis dentro do bloco. */
  diasUteis: number;
  /** Concluídas por técnico por dia útil; null sem dia útil ou sem técnico. */
  media: number | null;
}

export interface ResultadoCapacidade {
  /** Técnicos da equipe de preventiva (ativos). */
  tecnicos: number;
  semanas: SemanaCapacidade[];
  media4: number | null;
  media8: number | null;
  /** Menos de 2 semanas de histórico: a média ainda não é confiável. */
  poucosDados: boolean;
  /** Dias desde a primeira visita concluída (0 se nunca houve). */
  diasDeHistorico: number;
  /** Visitas por técnico por dia usadas na capacidade, e de onde vieram. */
  baseDia: number;
  baseTipo: 'real' | 'meta';
  meta: number;
  /** Mês considerado (YYYY-MM) e seus dias úteis. */
  mes: string;
  diasUteisMes: number;
  condominiosAtivos: number;
  visitasNecessarias: number;
  visitasPorCondominio: number;
  capacidadeMes: number;
  /** Condomínios que cabem com a equipe atual. */
  cabem: number;
  faltaCapacidade: boolean;
  metaCarteira: number;
  /** Técnicos para a carteira da meta (null sem produtividade pra calcular). */
  tecnicosParaMeta: number | null;
}

type OsCapacidade = Pick<OS, 'tipo' | 'status' | 'data_programada' | 'tecnico_id' | 'saida_em' | 'entrada_em'>;

/** Dia (YYYY-MM-DD, fuso da operação) em que a visita foi concluída. */
export function diaDaConclusao(os: OsCapacidade): string | undefined {
  // saida_em/entrada_em chegam como Date do Postgres e como string do JSON local.
  const instante = os.saida_em ?? os.entrada_em;
  if (instante) return hojeISO(new Date(instante));
  return os.data_programada || undefined;
}

function diasUteisEntre(inicio: string, fimExclusivo: string, diasUteis: readonly number[]): number {
  let n = 0;
  for (let d = inicio; d < fimExclusivo; d = somarDias(d, 1)) if (ehDiaUtil(d, diasUteis)) n++;
  return n;
}

export function calcularCapacidade({
  hoje,
  oss,
  condominios,
  tecnicos,
  meta,
  metaCarteira,
  diasUteis = DIAS_UTEIS_PREVENTIVA,
}: {
  hoje: string;
  oss: OsCapacidade[];
  /** Condomínios ativos (já filtrados). */
  condominios: { preventivas_por_mes?: number }[];
  /** Ids dos técnicos de preventiva ativos. */
  tecnicos: string[];
  /** Meta de visitas por técnico por dia (configuração). */
  meta: number;
  /** Meta da carteira (ex.: 200 condomínios). */
  metaCarteira: number;
  diasUteis?: readonly number[];
}): ResultadoCapacidade {
  const time = new Set(tecnicos);
  const concluidas = oss
    .filter((o) => o.tipo === 'preventiva' && o.status === 'finalizada')
    .map((o) => ({ dia: diaDaConclusao(o), tecnico: o.tecnico_id }))
    .filter((c): c is { dia: string; tecnico: string | undefined } => !!c.dia);

  // Histórico: da primeira conclusão (de qualquer técnico) até hoje.
  const primeira = concluidas.reduce<string | null>((min, c) => (min === null || c.dia < min ? c.dia : min), null);
  const diasDeHistorico = primeira ? Math.max(0, Math.round((Date.parse(`${hoje}T00:00:00Z`) - Date.parse(`${primeira}T00:00:00Z`)) / 86_400_000)) : 0;

  // Blocos de 7 dias terminando ontem (hoje ainda está em andamento), do mais antigo ao mais novo.
  const semanas: SemanaCapacidade[] = [];
  for (let k = SEMANAS_HISTORICO - 1; k >= 0; k--) {
    const fim = somarDias(hoje, -7 * k);
    const inicio = somarDias(fim, -7);
    const n = concluidas.filter((c) => c.tecnico && time.has(c.tecnico) && c.dia >= inicio && c.dia < fim).length;
    const du = diasUteisEntre(inicio, fim, diasUteis);
    semanas.push({ inicio, concluidas: n, diasUteis: du, media: du > 0 && time.size > 0 ? n / (du * time.size) : null });
  }
  const mediaDe = (blocos: SemanaCapacidade[]): number | null => {
    const dias = blocos.reduce((a, s) => a + s.diasUteis, 0);
    const n = blocos.reduce((a, s) => a + s.concluidas, 0);
    return dias > 0 && time.size > 0 ? n / (dias * time.size) : null;
  };
  const media4 = mediaDe(semanas.slice(-4));
  const media8 = mediaDe(semanas);

  const real = media4 && media4 > 0 ? media4 : media8 && media8 > 0 ? media8 : null;
  const baseDia = real ?? meta;

  const mes = hoje.slice(0, 7);
  const diasUteisMes = diasDoMes(mes, undefined, diasUteis).length;
  const visitasNecessarias = condominios.reduce((a, c) => a + normalizarFrequencia(c.preventivas_por_mes), 0);
  const visitasPorCondominio = condominios.length > 0 ? visitasNecessarias / condominios.length : 1;
  const capacidadeMes = tecnicos.length * baseDia * diasUteisMes;
  const produtividadeMes = baseDia * diasUteisMes; // visitas por técnico por mês
  return {
    tecnicos: tecnicos.length,
    semanas,
    media4,
    media8,
    poucosDados: diasDeHistorico < DIAS_MIN_HISTORICO,
    diasDeHistorico,
    baseDia,
    baseTipo: real === null ? 'meta' : 'real',
    meta,
    mes,
    diasUteisMes,
    condominiosAtivos: condominios.length,
    visitasNecessarias,
    visitasPorCondominio,
    capacidadeMes,
    cabem: Math.floor(capacidadeMes / visitasPorCondominio),
    faltaCapacidade: visitasNecessarias > capacidadeMes,
    metaCarteira,
    tecnicosParaMeta: produtividadeMes > 0 ? Math.ceil((metaCarteira * visitasPorCondominio) / produtividadeMes) : null,
  };
}
