// Agenda de visitas da OS (campo os.data_programada) — funções puras, sem
// I/O, usadas pela API (validação) e pelas telas (rota do dia).
//
// data_programada é DATA DE CALENDÁRIO (YYYY-MM-DD), não instante: "terça
// 28/10" é o mesmo dia pra todo mundo. Por isso nunca passa por `new Date()`
// pra comparar — compara string com string (o formato ISO ordena certo) e
// "hoje" é calculado no fuso da operação, não no fuso do servidor (o
// container roda em UTC: depois das 21h em São Paulo já seria "amanhã").
import type { OS } from './db';

export const FUSO_OPERACAO = 'America/Sao_Paulo';

const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Hoje (YYYY-MM-DD) no fuso da operação. */
export function hojeISO(agora: Date = new Date()): string {
  // en-CA formata como YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', { timeZone: FUSO_OPERACAO }).format(agora);
}

/**
 * Valida o valor recebido da API. `null`/'' = limpar o agendamento;
 * string YYYY-MM-DD de data real = ok; qualquer outra coisa = `undefined`
 * (inválido — a rota responde 400).
 */
export function normalizarDataProgramada(valor: unknown): string | null | undefined {
  if (valor === null || valor === '') return null;
  if (typeof valor !== 'string' || !DATA_ISO.test(valor)) return undefined;
  const [a, m, d] = valor.split('-').map(Number);
  const dt = new Date(Date.UTC(a, m - 1, d));
  if (dt.getUTCFullYear() !== a || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return undefined;
  return valor;
}

const DIAS_SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

/** "ter 28/10" — rótulo curto pra lista/rota. */
export function formatarDataCurta(iso: string): string {
  const [a, m, d] = iso.split('-').map(Number);
  const dia = DIAS_SEMANA[new Date(Date.UTC(a, m - 1, d)).getUTCDay()];
  return `${dia} ${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}`;
}

/** Soma dias a uma data YYYY-MM-DD (pra navegar ontem/amanhã na rota). */
export function somarDias(iso: string, dias: number): string {
  const [a, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(a, m - 1, d + dias));
  return dt.toISOString().slice(0, 10);
}

/** Início do dia agendado como instante (fuso da operação, UTC−3 fixo). */
export function inicioDoDiaProgramado(iso: string): number {
  return new Date(`${iso}T00:00:00-03:00`).getTime();
}

export function isOsAtiva(os: Pick<OS, 'status'>): boolean {
  return os.status !== 'finalizada' && os.status !== 'cancelada';
}

export interface RotaDoDia {
  /** Ativas agendadas exatamente pro dia escolhido. */
  doDia: OS[];
  /** Ativas com agendamento ANTERIOR ao dia (só quando o dia é hoje). */
  atrasadas: OS[];
  /** Ativas sem data de visita — ficam visíveis à parte pra nada sumir. */
  semData: OS[];
}

// Separa as OS ativas na rota de um dia. Atrasadas só entram quando o dia
// escolhido é hoje (olhando uma data futura, o atraso de hoje não é dela).
export function montarRotaDoDia(oss: OS[], dia: string, hoje: string = hojeISO()): RotaDoDia {
  const rota: RotaDoDia = { doDia: [], atrasadas: [], semData: [] };
  for (const os of oss) {
    if (!isOsAtiva(os)) continue;
    if (!os.data_programada) rota.semData.push(os);
    else if (os.data_programada === dia) rota.doDia.push(os);
    else if (dia === hoje && os.data_programada < hoje) rota.atrasadas.push(os);
  }
  return rota;
}

// Dias úteis da preventiva (0 = domingo ... 6 = sábado): segunda a sexta. O
// time trabalha ~22 dias por mês nas preventivas; sábado e domingo ficam pro
// plantão (corretivas). Única fonte dessa regra — o planejamento mensal e a
// reorganização da fila usam esta constante.
export const DIAS_UTEIS_PREVENTIVA: readonly number[] = [1, 2, 3, 4, 5];

// Com "Planejar preventivas aos sábados" ligado (configuração, 22/11), o
// sábado também entra. Domingo nunca. Quem planeja/reorganiza lê a
// configuração (meta-visitas.ts) e passa o resultado destas funções.
export const DIAS_UTEIS_COM_SABADO: readonly number[] = [1, 2, 3, 4, 5, 6];

export function diasUteisPreventiva(sabado: boolean): readonly number[] {
  return sabado ? DIAS_UTEIS_COM_SABADO : DIAS_UTEIS_PREVENTIVA;
}

/** A data (YYYY-MM-DD) cai num dia útil da preventiva? */
export function ehDiaUtil(iso: string, diasUteis: readonly number[] = DIAS_UTEIS_PREVENTIVA): boolean {
  const [a, m, d] = iso.split('-').map(Number);
  return diasUteis.includes(new Date(Date.UTC(a, m - 1, d)).getUTCDay());
}

/** Primeiro dia útil a partir de `iso` (inclusive). */
export function diaUtilApartirDe(iso: string, diasUteis: readonly number[] = DIAS_UTEIS_PREVENTIVA): string {
  if (diasUteis.length === 0) return iso;
  let d = iso;
  while (!ehDiaUtil(d, diasUteis)) d = somarDias(d, 1);
  return d;
}

/** Próximo dia útil DEPOIS de `iso` (exclusivo). */
export function proximoDiaUtil(iso: string, diasUteis: readonly number[] = DIAS_UTEIS_PREVENTIVA): string {
  return diaUtilApartirDe(somarDias(iso, 1), diasUteis);
}
