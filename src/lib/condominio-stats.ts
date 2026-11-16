// Estatísticas do Painel do Síndico — funções puras (mesmo espírito de
// src/lib/os-priority.ts), derivadas da lista de OS de UM condomínio já
// carregada pela tela (não existe endpoint de estatísticas agregadas
// ainda — ver comentário no topo de src/app/painel/[id]/page.tsx sobre o
// que falta no backend pra isso deixar de ser calculado no cliente).
import type { OS } from './db';
import { hojeISO } from './os-agenda';

export interface ManutencoesDoMes {
  total: number;
  preventivas: number;
  corretivas: number;
}

export function manutencoesDoMes(oss: OS[], referencia: Date = new Date()): ManutencoesDoMes {
  const ano = referencia.getFullYear();
  const mes = referencia.getMonth();
  const doMes = oss.filter((os) => {
    const d = new Date(os.criado_em);
    return d.getFullYear() === ano && d.getMonth() === mes;
  });
  return {
    total: doMes.length,
    preventivas: doMes.filter((o) => o.tipo === 'preventiva').length,
    corretivas: doMes.filter((o) => o.tipo === 'corretiva').length,
  };
}

// Tempo médio, em minutos, entre a abertura da OS (criado_em) e o técnico
// chegar em campo (entrada_em). Só entra na média quem já tem entrada_em
// registrado — OS ainda aberta sem técnico em campo enviesaria o número
// pra baixo se contasse "0 min" por engano.
export function tempoMedioRespostaMinutos(oss: OS[]): number | null {
  const comEntrada = oss.filter((o): o is OS & { entrada_em: string } => !!o.entrada_em);
  if (comEntrada.length === 0) return null;
  const totalMin = comEntrada.reduce((acc, o) => {
    const criado = new Date(o.criado_em).getTime();
    const entrada = new Date(o.entrada_em).getTime();
    return acc + Math.max(0, (entrada - criado) / 60_000);
  }, 0);
  return Math.round(totalMin / comEntrada.length);
}

export function formatarMinutos(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const resto = min % 60;
  return resto > 0 ? `${h}h ${resto}min` : `${h}h`;
}

// Ordena OS finalizadas da mais recente pra mais antiga, pro card de
// "Histórico de manutenções" — usa saida_em quando existe (fim real do
// atendimento), caindo pra criado_em nas que não têm.
export function ordenarHistoricoRecente(oss: OS[]): OS[] {
  return [...oss].sort((a, b) => {
    const da = new Date(a.saida_em || a.criado_em).getTime();
    const db = new Date(b.saida_em || b.criado_em).getTime();
    return db - da;
  });
}

// ----- Histórico por mês (pedido 14: "na pasta do mês: o técnico veio 4 vezes") -----

const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

/** Dia do atendimento (YYYY-MM-DD, fuso da operação): saída, senão dia agendado, senão abertura. */
export function diaDoAtendimento(os: Pick<OS, 'saida_em' | 'data_programada' | 'criado_em'>): string {
  if (os.saida_em) return hojeISO(new Date(os.saida_em));
  if (os.data_programada) return os.data_programada;
  return hojeISO(new Date(os.criado_em));
}

/** "2026-11" → "Novembro de 2026". */
export function rotuloMes(chave: string): string {
  const [a, m] = chave.split('-').map(Number);
  return `${MESES[m - 1]} de ${a}`;
}

export interface MesHistorico {
  chave: string; // YYYY-MM
  rotulo: string;
  oss: OS[]; // mais recente primeiro
  preventivas: number;
  corretivas: number;
}

/** OS finalizadas agrupadas por mês do atendimento, do mês mais recente pro mais antigo. */
export function historicoPorMes(oss: OS[]): MesHistorico[] {
  const porMes = new Map<string, OS[]>();
  for (const os of oss) {
    if (os.status !== 'finalizada') continue;
    const chave = diaDoAtendimento(os).slice(0, 7);
    porMes.set(chave, [...(porMes.get(chave) ?? []), os]);
  }
  return [...porMes.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([chave, lista]) => {
      const ordenadas = ordenarHistoricoRecente(lista);
      return {
        chave,
        rotulo: rotuloMes(chave),
        oss: ordenadas,
        preventivas: ordenadas.filter((o) => o.tipo === 'preventiva').length,
        corretivas: ordenadas.filter((o) => o.tipo === 'corretiva').length,
      };
    });
}

/** Próxima visita agendada (OS aberta ou em andamento, de hoje em diante). */
export function proximaVisita(oss: OS[], hoje: string = hojeISO()): OS | null {
  const futuras = oss
    .filter((o) => (o.status === 'aberta' || o.status === 'em_andamento') && o.data_programada && o.data_programada >= hoje)
    .sort((a, b) => a.data_programada!.localeCompare(b.data_programada!));
  return futuras[0] ?? null;
}
