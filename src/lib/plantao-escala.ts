// Escala de plantão — funções puras (sem I/O), usadas pela API e pela tela.
//
// Os períodos são INSTANTES (ISO, UTC) em que alguém fica de plantão. A
// equipe pensa em horário de São Paulo ("segunda 8h"), então tudo que entra
// ou sai daqui como data/hora local usa o fuso da operação (UTC−3 fixo, o
// mesmo que `inicioDoDiaProgramado` em os-agenda.ts; o Brasil não tem horário
// de verão desde 2019). Quem decide QUEM está de plantão em um instante é
// `plantonistasEm`, em plantao.ts.
import { periodoAtendimento } from './horario-comercial';
import { FUSO_OPERACAO, formatarDataCurta, hojeISO, somarDias } from './os-agenda';
import type { PeriodoEscala } from './plantao';

const DIA_MS = 24 * 60 * 60 * 1000;

/** Período mais longo aceito numa linha da escala. */
export const MAX_DIAS_PERIODO = 62;
/** Rodízio: no máximo este tanto de períodos gerados de uma vez. */
export const MAX_PERIODOS_RODIZIO = 60;
export const DIAS_SEMANA_NOME = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

/** "2026-11-23" + hora/minuto no horário de São Paulo → instante. */
export function instanteSP(dataISO: string, hora = 0, minuto = 0): Date {
  const hh = String(hora).padStart(2, '0');
  const mm = String(minuto).padStart(2, '0');
  return new Date(`${dataISO}T${hh}:${mm}:00-03:00`);
}

/** Valor de <input type="datetime-local"> ("2026-11-23T08:00", horário de SP) → ISO; inválido = undefined. */
export function localParaIso(local: unknown): string | undefined {
  if (typeof local !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) return undefined;
  const d = new Date(`${local}:00-03:00`);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

/** Instante → "2026-11-23T08:00" no horário de São Paulo (valor de <input type="datetime-local">). */
export function isoParaLocal(iso: string): string {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: FUSO_OPERACAO, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(iso));
  const p = (t: string) => partes.find((x) => x.type === t)?.value ?? '00';
  return `${p('year')}-${p('month')}-${p('day')}T${p('hour')}:${p('minute')}`;
}

/** "dom 23/11 08:00" — rótulo curto de um instante, no horário de São Paulo. */
export function formatarInstante(iso: string): string {
  const [data, hora] = isoParaLocal(iso).split('T');
  return `${formatarDataCurta(data)} ${hora}`;
}

/** Aceita só ISO válido (qualquer deslocamento); devolve normalizado em UTC ou undefined. */
export function normalizarInstante(valor: unknown): string | undefined {
  if (typeof valor !== 'string' || valor.trim() === '') return undefined;
  const d = new Date(valor);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

/** Confere um período novo: fim depois do início, não maior que o limite. Devolve a mensagem de erro ou null. */
export function erroDoPeriodo(inicio: string, fim: string): string | null {
  const i = new Date(inicio).getTime();
  const f = new Date(fim).getTime();
  if (!(f > i)) return 'O fim do plantão tem que ser depois do início.';
  if (f - i > MAX_DIAS_PERIODO * DIA_MS) return `Cada período pode ter no máximo ${MAX_DIAS_PERIODO} dias.`;
  return null;
}

/** Dois intervalos [inicio, fim) se cruzam? */
export function sePeriodosSobrepoem(a: Pick<PeriodoEscala, 'inicio' | 'fim'>, b: Pick<PeriodoEscala, 'inicio' | 'fim'>): boolean {
  return new Date(a.inicio).getTime() < new Date(b.fim).getTime() && new Date(b.inicio).getTime() < new Date(a.fim).getTime();
}

/**
 * Até quando vai a troca manual ("Trocar plantonista agora") quando NÃO há
 * período da escala em andamento: até o fim do plantão corrente (a próxima
 * abertura do horário comercial). Em horário comercial, o plantão que vale é o
 * da noite que vem: vai até a abertura seguinte a esse fechamento. Passo de 15 min.
 */
export function fimDaTrocaManual(agora: Date): Date {
  const PASSO = 15 * 60 * 1000;
  let t = agora.getTime();
  const limite = t + 10 * DIA_MS;
  // Acha o começo do plantão (agora, se já for plantão).
  while (periodoAtendimento(new Date(t)) === 'comercial' && t < limite) t += PASSO;
  // Daí até o horário comercial voltar.
  while (periodoAtendimento(new Date(t)) === 'plantao' && t < limite) t += PASSO;
  return new Date(t);
}

export interface EntradaRodizio {
  agora: Date;
  /** Ids dos técnicos, na ordem do rodízio. */
  usuarios: string[];
  /** Dia da troca: 0 = domingo ... 6 = sábado. */
  diaSemana: number;
  /** Hora da troca (0 a 23), horário de São Paulo. */
  hora: number;
  /** Duração de cada período, em dias (padrão 7). */
  duracaoDias: number;
  /** Quantas semanas cobrir: o total de períodos é semanas × 7 ÷ duração (arredondado pra cima). */
  semanas: number;
  /** Primeiro dia (YYYY-MM-DD) a considerar; sem ele, a próxima ocorrência do dia/hora da troca. */
  aPartirDe?: string;
}

export interface PeriodoGerado {
  usuario_id: string;
  inicio: string;
  fim: string;
}

function diaDaSemana(iso: string): number {
  const [a, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d)).getUTCDay();
}

/** Erro de entrada do rodízio (mensagem pra tela) ou null. */
export function erroDoRodizio(e: Pick<EntradaRodizio, 'usuarios' | 'diaSemana' | 'hora' | 'duracaoDias' | 'semanas'>): string | null {
  if (e.usuarios.length === 0) return 'Escolha pelo menos um técnico para o rodízio.';
  if (new Set(e.usuarios).size !== e.usuarios.length) return 'Cada técnico só pode aparecer uma vez na ordem.';
  if (!Number.isInteger(e.diaSemana) || e.diaSemana < 0 || e.diaSemana > 6) return 'Dia da troca inválido.';
  if (!Number.isInteger(e.hora) || e.hora < 0 || e.hora > 23) return 'Hora da troca inválida (0 a 23).';
  if (!Number.isInteger(e.duracaoDias) || e.duracaoDias < 1 || e.duracaoDias > MAX_DIAS_PERIODO) return `A duração deve ser de 1 a ${MAX_DIAS_PERIODO} dias.`;
  if (!Number.isInteger(e.semanas) || e.semanas < 1 || e.semanas > 52) return 'Quantas semanas: de 1 a 52.';
  if (Math.ceil((e.semanas * 7) / e.duracaoDias) > MAX_PERIODOS_RODIZIO) return `O rodízio passa de ${MAX_PERIODOS_RODIZIO} períodos. Diminua as semanas.`;
  return null;
}

/**
 * Rodízio: a cada `duracaoDias` troca o plantonista, na ordem escolhida e
 * voltando ao primeiro no fim da lista. O primeiro período começa na próxima
 * ocorrência do dia/hora da troca (hoje, se ainda não passou da hora) ou no
 * primeiro dia da semana certa a partir de `aPartirDe`.
 */
export function gerarRodizio(e: EntradaRodizio): PeriodoGerado[] {
  if (erroDoRodizio(e)) return [];
  const hoje = hojeISO(e.agora);
  let primeiro = e.aPartirDe && e.aPartirDe > hoje ? e.aPartirDe : hoje;
  while (diaDaSemana(primeiro) !== e.diaSemana) primeiro = somarDias(primeiro, 1);
  // A troca de hoje já passou: vale a da semana que vem.
  if (primeiro === hoje && instanteSP(hoje, e.hora).getTime() <= e.agora.getTime()) primeiro = somarDias(primeiro, 7);
  const total = Math.ceil((e.semanas * 7) / e.duracaoDias);
  const periodos: PeriodoGerado[] = [];
  for (let k = 0; k < total; k++) {
    const dIni = somarDias(primeiro, k * e.duracaoDias);
    const dFim = somarDias(dIni, e.duracaoDias);
    periodos.push({
      usuario_id: e.usuarios[k % e.usuarios.length],
      inicio: instanteSP(dIni, e.hora).toISOString(),
      fim: instanteSP(dFim, e.hora).toISOString(),
    });
  }
  return periodos;
}

/** Um período já terminou em `agora`? */
export function periodoEncerrado(p: Pick<PeriodoEscala, 'fim'>, agora: Date): boolean {
  return new Date(p.fim).getTime() <= agora.getTime();
}

/** Um período já começou em `agora`? */
export function periodoIniciado(p: Pick<PeriodoEscala, 'inicio'>, agora: Date): boolean {
  return new Date(p.inicio).getTime() <= agora.getTime();
}
