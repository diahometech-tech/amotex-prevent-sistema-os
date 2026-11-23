// Planejamento mensal das preventivas — função pura, sem I/O.
//
// Regra da Amotex (23/10): a preventiva é feita pelo(s) técnico(s) de
// especialidade "preventiva" (ou pelos que fazem as duas). Dias úteis da
// preventiva: segunda a sexta (DIAS_UTEIS_PREVENTIVA, em os-agenda.ts) —
// sábado e domingo são plantão. Hoje são ~70 condomínios — em expansão, então nada aqui
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
// 4. Capacidade por técnico por dia = a META de visitas por técnico/dia
//    (20/11: padrão 5, ajustável na tela de Rotas); e por técnico no mês =
//    teto(total / técnicos) — com um 2º técnico de preventiva, a carga se
//    divide. Se a meta não comporta tudo, o excedente vai pro dia mais perto
//    e a reorganização diária (reorganizar-fila.ts) desliza o que passar.
// 5. Região (22/11): condomínio ganha `regiao` e `cep`. A ordem de quem
//    entra deixa de ser alfabética: é por região e, dentro dela, por CEP
//    (sem região = no fim de cada grupo). A regra do dia do mês (item 2)
//    continua valendo ANTES: a região só decide o que sobra — qual técnico
//    pega a visita num dia-alvo e, para condomínio novo, qual dia/técnico:
//    prefere o técnico/dia que já tem visita da mesma região, depois um dia
//    ainda sem região, e só por último mistura regiões no mesmo dia. Quem não
//    tem região segue a regra antiga (dia mais vazio).
// 6. Mês corrente: só agenda de hoje em diante. Visita do ciclo que já
//    passou não é recriada; se TODAS já passaram e o condomínio não teve
//    nenhuma no mês, ganha uma no dia mais próximo.
import type { OS } from './db';
import { DIAS_UTEIS_PREVENTIVA, ehDiaUtil, somarDias } from './os-agenda';
import { compararGeografico } from './regioes';

/** Meta padrão de visitas por técnico por dia (a configurável fica em meta-visitas.ts). */
export const META_PADRAO_PLANEJAMENTO = 5;

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
  /** Máximo de visitas por técnico por dia usado no cálculo (a meta). */
  capacidadeDia: number;
  /** Visitas que passam da meta num mesmo técnico/dia (a meta não comporta o mês). */
  acimaDaMeta: number;
}

export type Frequencia = 1 | 2 | 4;

/**
 * Técnicos que entram no planejamento: os de especialidade "preventiva"; sem
 * nenhum, os que fazem as duas (sem especialidade) — a equipe de plantonistas
 * do piloto. Só ativos. Usado pelo planejamento e pelo gráfico de capacidade.
 */
export function tecnicosDePreventiva<T extends { papel: string; ativo: boolean; especialidade?: string }>(users: T[]): T[] {
  const ativos = users.filter((u) => u.papel === 'tecnico' && u.ativo);
  const dedicados = ativos.filter((u) => u.especialidade === 'preventiva');
  return dedicados.length > 0 ? dedicados : ativos.filter((u) => !u.especialidade);
}

const MES_ISO = /^\d{4}-(0[1-9]|1[0-2])$/;

export function mesValido(mes: unknown): mes is string {
  return typeof mes === 'string' && MES_ISO.test(mes);
}

/** Dias do mês (YYYY-MM-DD) a partir de `aPartirDe` (inclusive). */
export function diasDoMes(mes: string, aPartirDe?: string, diasUteis?: readonly number[]): string[] {
  const dias: string[] = [];
  for (let d = `${mes}-01`; d.startsWith(mes); d = somarDias(d, 1)) {
    if (aPartirDe && d < aPartirDe) continue;
    if (diasUteis && !ehDiaUtil(d, diasUteis)) continue;
    dias.push(d);
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
  meta = META_PADRAO_PLANEJAMENTO,
  diasUteis = DIAS_UTEIS_PREVENTIVA,
}: {
  mes: string;
  hoje: string;
  condominios: { id: string; nome: string; preventivas_por_mes?: number; regiao?: string; cep?: string }[];
  /** Ids dos técnicos de preventiva ativos. */
  tecnicos: string[];
  /** Todas as OS (o histórico de preventivas sai daqui). */
  oss: Pick<OS, 'condominio_id' | 'tipo' | 'status' | 'data_programada' | 'tecnico_id'>[];
  /** Visitas por técnico por dia (capacidade diária). */
  meta?: number;
  /** Dias da semana (0 = domingo) em que a preventiva é agendada. */
  diasUteis?: readonly number[];
}): ResultadoPlano {
  const todosDias = diasDoMes(mes);
  // Só dias úteis recebem visita; os dias-alvo que caem no fim de semana vão
  // pro dia útil mais perto (ver `agendar`).
  const dias = diasDoMes(mes, hoje.startsWith(mes) ? hoje : undefined, diasUteis);
  const vazio = { itens: [], jaAgendados: 0, dias, capacidadeDia: 0, acimaDaMeta: 0 };
  if (dias.length === 0 || tecnicos.length === 0) return vazio;
  const ultimoDia = diaDoMes(todosDias[todosDias.length - 1]);
  const primeiroDisponivel = diaDoMes(dias[0]);

  const preventivas = oss.filter((o) => o.tipo === 'preventiva' && o.status !== 'cancelada' && o.data_programada);
  const carga = new Map<string, number>(); // `${tecnico}|${dia}` → visitas
  const chave = (t: string, d: string) => `${t}|${d}`;
  // Regiões com visita em cada técnico/dia (só condomínio com região entra).
  const regiaoDe = new Map(condominios.map((c) => [c.id, c.regiao ?? '']));
  const regioesNoDia = new Map<string, Set<string>>();
  const anotarRegiao = (t: string, d: string, regiao: string) => {
    if (!regiao) return;
    const k = chave(t, d);
    regioesNoDia.set(k, (regioesNoDia.get(k) ?? new Set()).add(regiao));
  };
  // 0 = o técnico já tem visita dessa região no dia; 1 = dia sem região
  // nenhuma (ou condomínio sem região: neutro); 2 = só de outras regiões (misturaria).
  const afinidade = (t: string, d: string, regiao: string): 0 | 1 | 2 => {
    if (!regiao) return 1;
    const set = regioesNoDia.get(chave(t, d));
    if (!set || set.size === 0) return 1;
    return set.has(regiao) ? 0 : 2;
  };
  const noMes = new Map<string, string[]>(); // condomínio → datas já agendadas no mês
  for (const o of preventivas) {
    if (!o.data_programada!.startsWith(mes)) continue;
    noMes.set(o.condominio_id, [...(noMes.get(o.condominio_id) ?? []), o.data_programada!]);
    if (o.tecnico_id && tecnicos.includes(o.tecnico_id) && dias.includes(o.data_programada!)) {
      const k = chave(o.tecnico_id, o.data_programada!);
      carga.set(k, (carga.get(k) ?? 0) + 1);
      anotarRegiao(o.tecnico_id, o.data_programada!, regiaoDe.get(o.condominio_id) ?? '');
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
    c: { id: string; nome: string; regiao?: string; cep?: string };
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
  const capacidadeDia = Math.max(1, Math.floor(meta));
  const capacidadeMes = Math.ceil((totalVisitas + jaNoPeriodo) / tecnicos.length);

  const cargaTotal = (t: string) => dias.reduce((acc, d) => acc + (carga.get(chave(t, d)) ?? 0), 0);
  const ocupar = (t: string, d: string, regiao = '') => {
    carga.set(chave(t, d), (carga.get(chave(t, d)) ?? 0) + 1);
    anotarRegiao(t, d, regiao);
  };
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
    const regiao = pd.c.regiao ?? '';
    let preferido = pd.tecnicoPreferido;
    for (const alvo of alvos) {
      const porDistancia = [...dias].sort(
        (a, b) => Math.abs(diaDoMes(a) - alvo) - Math.abs(diaDoMes(b) - alvo) || a.localeCompare(b)
      );
      // Técnicos na ordem de preferência NAQUELE dia: quem já tem visita da
      // mesma região; depois o técnico de sempre (se o dia dele está sem
      // região); depois dia sem região; por último quem misturaria regiões.
      const ordemTecnicos = (d: string) => {
        const nota = (t: string) => {
          const a = afinidade(t, d, regiao);
          return a === 0 ? 0 : a === 1 ? (t === preferido ? 1 : 2) : t === preferido ? 3 : 4;
        };
        return [...tecnicos].sort((a, b) => nota(a) - nota(b) || cargaTotal(a) - cargaTotal(b));
      };
      const longeDosOutros = (d: string) => ocupados.every((o) => Math.abs(diaDoMes(d) - o) >= minGap);
      let escolhido: ItemPlano | null = null;
      for (const d of porDistancia) {
        if (!longeDosOutros(d)) continue;
        const t = ordemTecnicos(d).find((tec) => temVaga(tec, d));
        if (t) { escolhido = { condominio_id: pd.c.id, tecnico_id: t, data: d }; break; }
      }
      // Sem vaga (a meta não comporta o mês: `acimaDaMeta` avisa na prévia), o
      // dia mais perto que não repete o mesmo dia do condomínio.
      if (!escolhido) {
        const d = porDistancia.find((x) => !ocupados.includes(diaDoMes(x))) ?? porDistancia[0];
        escolhido = { condominio_id: pd.c.id, tecnico_id: ordemTecnicos(d)[0], data: d };
      }
      ocupar(escolhido.tecnico_id, escolhido.data, regiao);
      ocupados.push(diaDoMes(escolhido.data));
      preferido ??= escolhido.tecnico_id;
      itens.push(escolhido);
    }
  };

  // Com referência primeiro (pela posição no mês; no mesmo dia, por região e
  // CEP), depois os novos, também por região e CEP (sem região por último).
  const comReferencia = pendentes
    .filter((pd) => pd.referencia !== undefined)
    .sort((a, b) => a.referencia! - b.referencia! || compararGeografico(a.c, b.c));
  const novos = pendentes
    .filter((pd) => pd.referencia === undefined)
    .sort((a, b) => compararGeografico(a.c, b.c));

  for (const pd of comReferencia) agendar(pd, alvosDe(pd, pd.referencia!));

  for (const pd of novos) {
    const regiao = pd.c.regiao ?? '';
    // Técnico menos carregado no mês.
    const t = [...tecnicos].sort((a, b) => cargaTotal(a) - cargaTotal(b))[0];
    if (pd.f === 1 && regiao) {
      // Mensal com região: o técnico/dia (com vaga) que já tem visita dessa
      // região; sem isso, dia sem região (o mais vazio, depois o mais cedo,
      // com o técnico menos carregado); só por último mistura.
      let melhor: { t: string; d: string; nota: number; cg: number; total: number } | null = null;
      for (const tec of tecnicos) {
        for (const d of dias) {
          if (!temVaga(tec, d)) continue;
          const c = { t: tec, d, nota: afinidade(tec, d, regiao), cg: carga.get(chave(tec, d)) ?? 0, total: cargaTotal(tec) };
          const melhorQue =
            !melhor ||
            c.nota < melhor.nota ||
            (c.nota === melhor.nota &&
              (c.nota === 0
                ? c.total < melhor.total
                : c.cg < melhor.cg || (c.cg === melhor.cg && c.total < melhor.total)));
          if (melhorQue) melhor = c;
        }
      }
      if (melhor) {
        ocupar(melhor.t, melhor.d, regiao);
        itens.push({ condominio_id: pd.c.id, tecnico_id: melhor.t, data: melhor.d });
        continue;
      }
      // Sem vaga em lugar nenhum: segue a regra antiga abaixo (acima da meta).
    }
    if (pd.f === 1) {
      // Mensal: o dia mais vazio desse técnico (empate: o mais cedo) — na
      // prática um rodízio que espalha a carga pelo mês.
      let melhor: { d: string; carga: number } | null = null;
      for (const d of dias) {
        const cg = carga.get(chave(t, d)) ?? 0;
        if (!melhor || cg < melhor.carga) melhor = { d, carga: cg };
      }
      ocupar(t, melhor!.d, regiao);
      itens.push({ condominio_id: pd.c.id, tecnico_id: t, data: melhor!.d });
      continue;
    }
    // Quinzenal/semanal: o início do 1º ciclo que cabe mais visitas no que
    // resta do mês e, empatado, deixa a carga desse técnico mais leve.
    const p = periodo(pd.f, ultimoDia);
    let melhor: { inicio: number; alvos: number[]; peso: number; mesma: number; mistura: number } | null = null;
    for (let inicio = 1; inicio <= p; inicio++) {
      const alvos = alvosDe(pd, inicio);
      const dataDe = (a: number) => `${mes}-${String(a).padStart(2, '0')}`;
      const peso = alvos.reduce((acc, a) => acc + (carga.get(chave(t, dataDe(a))) ?? 0), 0);
      // Quantos dos dias-alvo já têm a mesma região / só outra região.
      const af = alvos.map((a) => afinidade(t, dataDe(a), regiao));
      const mesma = regiao ? af.filter((x) => x === 0).length : 0;
      const mistura = regiao ? af.filter((x) => x === 2).length : 0;
      const melhorQue =
        !melhor ||
        alvos.length > melhor.alvos.length ||
        (alvos.length === melhor.alvos.length &&
          (mesma > melhor.mesma ||
            (mesma === melhor.mesma && (mistura < melhor.mistura || (mistura === melhor.mistura && peso < melhor.peso)))));
      if (melhorQue) melhor = { inicio, alvos, peso, mesma, mistura };
    }
    agendar({ ...pd, tecnicoPreferido: t }, melhor!.alvos);
  }

  itens.sort((a, b) => a.data.localeCompare(b.data));
  const acimaDaMeta = [...carga.values()].reduce((a, v) => a + Math.max(0, v - capacidadeDia), 0);
  return { itens, jaAgendados, dias, capacidadeDia, acimaDaMeta };
}
