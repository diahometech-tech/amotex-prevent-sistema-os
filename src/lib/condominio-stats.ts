// Estatísticas do Painel do Síndico — funções puras (mesmo espírito de
// src/lib/os-priority.ts), derivadas da lista de OS de UM condomínio já
// carregada pela tela (não existe endpoint de estatísticas agregadas
// ainda — ver comentário no topo de src/app/painel/[id]/page.tsx sobre o
// que falta no backend pra isso deixar de ser calculado no cliente).
import type { OS } from './db';

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
