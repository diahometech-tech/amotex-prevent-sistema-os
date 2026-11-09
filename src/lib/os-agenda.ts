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
