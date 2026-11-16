// Planejamento mensal das preventivas — função pura, sem I/O.
//
// Regra da Amotex (23/10): a preventiva é feita pelo(s) técnico(s) de
// especialidade "preventiva" (ou pelos que fazem as duas), com atendimento de
// segunda a domingo. Hoje são ~70 condomínios — em expansão, então nada aqui
// assume esses números.
//
// Frequência (pedido 9, 16/11): cada condomínio tem `preventivas_por_mes`
// (cadastro › contrato): 1 = mensal (padrão), 2 = quinzenal (a cada 14 dias,
// mesmo dia da semana), 4 = semanal (a cada 7 dias).
//
// Como distribui:
// 1. Idempotente: conta as preventivas que o condomínio já tem no mês
//    (qualquer status menos cancelada) e só cria as que faltam. Rodar de novo
//    não duplica.
// 2. Cadência estável: quem teve preventiva antes volta no MESMO dia do mês
//    (mensal) ou na mesma posição do ciclo (quinzenal/semanal: dia de
//    referência = último atendimento, trazido pra dentro do 1º ciclo do mês),
//    de preferência com o mesmo técnico. Se o dia lotou pra todos os
//    técnicos, vai pro dia mais próximo com vaga — sem colar duas visitas do
//    mesmo condomínio (mínimo de meio ciclo entre elas).
// 3. Sem histórico: mensal preenche os dias menos carregados, em ordem
//    alfabética (rodízio); quinzenal/semanal escolhe o dia de início do 1º
//    ciclo que deixa a carga mais leve.
// 4. Capacidade por técnico por dia = teto(total / (dias × técnicos)), então
//    nenhum dia fica com o dobro de outro; e por técnico no mês =
//    teto(total / técnicos) — com um 2º técnico de preventiva, a carga se
//    divide.
// 5. Mês corrente: só agenda de hoje em diante. Visita do ciclo que já
//    passou não é recriada; se TODAS já passaram e o condomínio não teve
//    nenhuma no mês, ganha uma no dia mais próximo.
import type { OS } from './db';
import { somarDias } from './os-agenda';

export interface ItemPlano {
  condominio_id: string;
  tecnico_id: string;
  data: string; // YYYY-MM-DD
}

export interface ResultadoPlano {
  itens: ItemPlano[];
  /** Preventivas que já existiam no mês (dos condomínios do plano) e foram mantidas. */
  jaAgendados: number;
  /** Dias disponíveis considerados (YYYY-MM-DD). */
  dias: string[];
  /** Máximo de visitas por técnico por dia usado no cálculo. */
  capacidadeDia: number;
}

export type Frequencia = 1 | 2 | 4;

const MES_ISO = /^\d{4}-(0[1-9]|1[0-2])$/;

export function mesValido(mes: unknown): mes is string {
  return typeof mes === 'string' && MES_ISO.test(mes);
}

/** Dias do mês (YYYY-MM-DD) a partir de `aPartirDe` (inclusive). */
export function diasDoMes(mes: string, aPartirDe?: string): string[] {
  const dias: string[] = [];
  for (let d = `${mes}-01`; d.startsWith(mes); d = somarDias(d, 1)) {
    if (!aPartirDe || d >= aPartirDe) dias.push(d);
  }
  return dias;
}

function diaDoMes(iso: string): number {
  return Number(iso.slice(8, 10));
}

export function normalizarFrequencia(n: unknown): Frequencia {
  return n === 2 || n === 4 ? n : 1;
}

/** Dias entre visitas: semanal 7, quinzenal 14, mensal = o mês todo. */
function periodo(f: Frequencia, ultimoDia: number): number {
  return f === 4 ? 7 : f === 2 ? 14 : ultimoDia;
}

/** Dias do mês (número) do ciclo que começa em `inicio`. */
function alvosDoCiclo(inicio: number, f: Frequencia, ultimoDia: number): number[] {
  const p = periodo(f, ultimoDia);
  const alvos: number[] = [];
  for (let k = 0; k < f; k++) alvos.push(Math.min(inicio + k * p, ultimoDia));
  return alvos;
}

/** Tira de `alvos` o mais próximo de cada visita que já existe no mês. */
function descontarExistentes(alvos: number[], existentes: number[]): number[] {
  const resto = [...alvos];
  for (const e of existentes) {
    if (resto.length === 0) break;
    let melhor = 0;
    for (let i = 1; i < resto.length; i++) {
      if (Math.abs(resto[i] - e) < Math.abs(resto[melhor] - e)) melhor = i;
    }
    resto.splice(melhor, 1);
  }
  return resto;
}

export function planejarPreventivasMes({
  mes,
  hoje,
  condominios,
  tecnicos,
  oss,
}: {
  mes: string;
  hoje: string;
  condominios: { id: string; nome: string; preventivas_por_mes?: number }[];
  /** Ids dos técnicos de preventiva ativos. */
  tecnicos: string[];
  /** Todas as OS (o histórico de preventivas sai daqui). */
  oss: Pick<OS, 'condominio_id' | 'tipo' | 'status' | 'data_programada' | 'tecnico_id'>[];
}): ResultadoPlano {
  const todosDias = diasDoMes(mes);
  const dias = diasDoMes(mes, hoje.startsWith(mes) ? hoje : undefined);
  const vazio = { itens: [], jaAgendados: 0, dias, capacidadeDia: 0 };
  if (dias.length === 0 || tecnicos.length === 0) return vazio;
  const ultimoDia = diaDoMes(todosDias[todosDias.length - 1]);
  const primeiroDisponivel = diaDoMes(dias[0]);

  const preventivas = oss.filter((o) => o.tipo === 'preventiva' && o.status !== 'cancelada' && o.data_programada);
  const carga = new Map<string, number>(); // `${tecnico}|${dia}` → visitas
  const chave = (t: string, d: string) => `${t}|${d}`;
  const noMes = new Map<string, string[]>(); // condomínio → datas já agendadas no mês
  for (const o of preventivas) {
    if (!o.data_programada!.startsWith(mes)) continue;
    noMes.set(o.condominio_id, [...(noMes.get(o.condominio_id) ?? []), o.data_programada!]);
    if (o.tecnico_id && tecnicos.includes(o.tecnico_id) && dias.includes(o.data_programada!)) {
      const k = chave(o.tecnico_id, o.data_programada!);
      carga.set(k, (carga.get(k) ?? 0) + 1);
    }
  }

  // Última preventiva ANTERIOR ao mês de cada condomínio (dia + técnico).
  const inicioMes = `${mes}-01`;
  const ultima = new Map<string, { dia: number; tecnico?: string; data: string }>();
  for (const o of preventivas) {
    if (o.data_programada! >= inicioMes) continue;
    const atual = ultima.get(o.condominio_id);
    if (!atual || o.data_programada! > atual.data) {
      ultima.set(o.condominio_id, { dia: diaDoMes(o.data_programada!), tecnico: o.tecnico_id, data: o.data_programada! });
    }
  }

  // Quanto cada condomínio precisa e, quando dá, os dias-alvo do mês.
  interface Pendente {
    c: { id: string; nome: string };
    f: Frequencia;
    existentes: number[]; // dias do mês já agendados
    faltam: number;
    referencia?: number; // dia de referência do ciclo (histórico ou 1ª visita do mês)
    tecnicoPreferido?: string;
  }
  let jaAgendados = 0;
  const pendentes: Pendente[] = [];
  for (const c of condominios) {
    const f = normalizarFrequencia(c.preventivas_por_mes);
    const datas = noMes.get(c.id) ?? [];
    jaAgendados += datas.length;
    const faltam = f - datas.length;
    if (faltam <= 0) continue;
    const existentes = datas.map(diaDoMes).sort((a, b) => a - b);
    const hist = ultima.get(c.id);
    const refBruta = hist?.dia ?? existentes[0];
    const p = periodo(f, ultimoDia);
    pendentes.push({
      c, f, existentes, faltam,
      referencia: refBruta === undefined ? undefined : f === 1 ? Math.min(refBruta, ultimoDia) : ((refBruta - 1) % p) + 1,
      tecnicoPreferido: hist?.tecnico,
    });
  }

  // Dias-alvo de quem tem referência: ciclo − o que já existe − o que já passou.
  const alvosDe = (pd: Pendente, inicio: number): number[] => {
    const ciclo = descontarExistentes(alvosDoCiclo(inicio, pd.f, ultimoDia), pd.existentes);
    const futuros = ciclo.filter((d) => d >= primeiroDisponivel).slice(0, pd.faltam);
    if (futuros.length === 0 && pd.existentes.length === 0 && ciclo.length > 0) return [Math.max(...ciclo)];
    return futuros;
  };

  const totalVisitas =
    pendentes.reduce(
      (acc, pd) =>
        acc +
        (pd.referencia !== undefined
          ? alvosDe(pd, pd.referencia).length
          : Math.min(pd.faltam, Math.max(1, Math.ceil(dias.length / periodo(pd.f, ultimoDia))))),
      0
    );
  const jaNoPeriodo = [...carga.values()].reduce((a, b) => a + b, 0);
  const capacidadeDia = Math.max(1, Math.ceil((totalVisitas + jaNoPeriodo) / (dias.length * tecnicos.length)));
  const capacidadeMes = Math.ceil((totalVisitas + jaNoPeriodo) / tecnicos.length);

  const cargaTotal = (t: string) => dias.reduce((acc, d) => acc + (carga.get(chave(t, d)) ?? 0), 0);
  const ocupar = (t: string, d: string) => carga.set(chave(t, d), (carga.get(chave(t, d)) ?? 0) + 1);
  const temVaga = (t: string, d: string) =>
    (carga.get(chave(t, d)) ?? 0) < capacidadeDia && cargaTotal(t) < capacidadeMes;

  const itens: ItemPlano[] = [];

  // Agenda as visitas de um condomínio nos dias-alvo. Manter o DIA vale mais
  // que manter o técnico: no dia-alvo tenta o técnico preferido e depois os
  // outros; só então passa pro dia vizinho. Duas visitas do mesmo condomínio
  // ficam a pelo menos meio ciclo uma da outra.
  const agendar = (pd: Pendente, alvos: number[]) => {
    const minGap = pd.f === 1 ? 1 : Math.ceil(periodo(pd.f, ultimoDia) / 2);
    const ocupados = [...pd.existentes];
    let preferido = pd.tecnicoPreferido;
    for (const alvo of alvos) {
      const porDistancia = [...dias].sort(
        (a, b) => Math.abs(diaDoMes(a) - alvo) - Math.abs(diaDoMes(b) - alvo) || a.localeCompare(b)
      );
      const ordemTecnicos = [...tecnicos].sort((a, b) =>
        a === preferido ? -1 : b === preferido ? 1 : cargaTotal(a) - cargaTotal(b)
      );
      const longeDosOutros = (d: string) => ocupados.every((o) => Math.abs(diaDoMes(d) - o) >= minGap);
      let escolhido: ItemPlano | null = null;
      for (const d of porDistancia) {
        if (!longeDosOutros(d)) continue;
        const t = ordemTecnicos.find((tec) => temVaga(tec, d));
        if (t) { escolhido = { condominio_id: pd.c.id, tecnico_id: t, data: d }; break; }
      }
      // Capacidade é teto da média, então quase sempre há vaga; sem vaga, o
      // dia mais perto que não repete o mesmo dia do condomínio.
      if (!escolhido) {
        const d = porDistancia.find((x) => !ocupados.includes(diaDoMes(x))) ?? porDistancia[0];
        escolhido = { condominio_id: pd.c.id, tecnico_id: ordemTecnicos[0], data: d };
      }
      ocupar(escolhido.tecnico_id, escolhido.data);
      ocupados.push(diaDoMes(escolhido.data));
      preferido ??= escolhido.tecnico_id;
      itens.push(escolhido);
    }
  };

  // Com referência primeiro (pela posição no mês), depois os novos por nome.
  const comReferencia = pendentes
    .filter((pd) => pd.referencia !== undefined)
    .sort((a, b) => a.referencia! - b.referencia! || a.c.nome.localeCompare(b.c.nome, 'pt-BR'));
  const novos = pendentes
    .filter((pd) => pd.referencia === undefined)
    .sort((a, b) => a.c.nome.localeCompare(b.c.nome, 'pt-BR'));

  for (const pd of comReferencia) agendar(pd, alvosDe(pd, pd.referencia!));

  for (const pd of novos) {
    // Técnico menos carregado no mês.
    const t = [...tecnicos].sort((a, b) => cargaTotal(a) - cargaTotal(b))[0];
    if (pd.f === 1) {
      // Mensal: o dia mais vazio desse técnico (empate: o mais cedo) — na
      // prática um rodízio que espalha a carga pelo mês.
      let melhor: { d: string; carga: number } | null = null;
      for (const d of dias) {
        const cg = carga.get(chave(t, d)) ?? 0;
        if (!melhor || cg < melhor.carga) melhor = { d, carga: cg };
      }
      ocupar(t, melhor!.d);
      itens.push({ condominio_id: pd.c.id, tecnico_id: t, data: melhor!.d });
      continue;
    }
    // Quinzenal/semanal: o início do 1º ciclo que cabe mais visitas no que
    // resta do mês e, empatado, deixa a carga desse técnico mais leve.
    const p = periodo(pd.f, ultimoDia);
    let melhor: { inicio: number; alvos: number[]; peso: number } | null = null;
    for (let inicio = 1; inicio <= p; inicio++) {
      const alvos = alvosDe(pd, inicio);
      const peso = alvos.reduce((acc, a) => acc + (carga.get(chave(t, `${mes}-${String(a).padStart(2, '0')}`)) ?? 0), 0);
      if (!melhor || alvos.length > melhor.alvos.length || (alvos.length === melhor.alvos.length && peso < melhor.peso)) {
        melhor = { inicio, alvos, peso };
      }
    }
    agendar({ ...pd, tecnicoPreferido: t }, melhor!.alvos);
  }

  itens.sort((a, b) => a.data.localeCompare(b.data));
  return { itens, jaAgendados, dias, capacidadeDia };
}
