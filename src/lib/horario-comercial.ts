// Horário comercial da Amotex x plantão — regra do Dm (20/11):
//   segunda a sexta  8h às 18h  → comercial
//   sábado           8h às 16h  → comercial
//   fora disso, e domingo o dia todo → plantão
// "Depois ajustamos": é só mexer na tabela HORARIO_COMERCIAL abaixo — não há
// tela de configuração por enquanto. Quem decide o aviso de corretiva
// (src/lib/plantao.ts) pergunta aqui em que período está.
//
// Puro (sem I/O) e sem dependência de servidor: pode ser usado no cliente.
// Feriados NÃO são tratados (contam como o dia da semana normal).

/** Fuso em que o horário comercial é contado (o servidor roda em UTC). */
export const FUSO_COMERCIAL = 'America/Sao_Paulo';

export type PeriodoAtendimento = 'comercial' | 'plantao';

/**
 * Janela comercial por dia da semana (0 = domingo ... 6 = sábado).
 * `abre` e `fecha` são horas cheias no fuso acima; vale de `abre` (inclusive)
 * até `fecha` (exclusive): às 18h em ponto já é plantão. `null` = o dia todo
 * é plantão.
 */
export const HORARIO_COMERCIAL: Record<number, { abre: number; fecha: number } | null> = {
  0: null, // domingo: plantão o dia todo
  1: { abre: 8, fecha: 18 },
  2: { abre: 8, fecha: 18 },
  3: { abre: 8, fecha: 18 },
  4: { abre: 8, fecha: 18 },
  5: { abre: 8, fecha: 18 },
  6: { abre: 8, fecha: 16 }, // sábado: só até as 16h
};

const DIAS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

const formatador = new Intl.DateTimeFormat('en-US', {
  timeZone: FUSO_COMERCIAL,
  weekday: 'short',
  hour: 'numeric',
  minute: 'numeric',
  hourCycle: 'h23',
});

/** Dia da semana (0 = domingo) e hora decimal (14.5 = 14h30) no fuso comercial. */
function diaEHora(agora: Date): { dia: number; hora: number } {
  const partes = formatador.formatToParts(agora);
  const pega = (tipo: string) => partes.find((p) => p.type === tipo)?.value ?? '0';
  return { dia: DIAS[pega('weekday')] ?? 0, hora: Number(pega('hour')) + Number(pega('minute')) / 60 };
}

export function periodoAtendimento(agora: Date = new Date()): PeriodoAtendimento {
  const { dia, hora } = diaEHora(agora);
  const janela = HORARIO_COMERCIAL[dia];
  return janela && hora >= janela.abre && hora < janela.fecha ? 'comercial' : 'plantao';
}

export function emHorarioComercial(agora: Date = new Date()): boolean {
  return periodoAtendimento(agora) === 'comercial';
}
