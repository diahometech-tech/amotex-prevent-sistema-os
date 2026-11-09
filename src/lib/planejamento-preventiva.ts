// Planejamento mensal das preventivas — função pura, sem I/O.
//
// Regra da Amotex (23/10): cada condomínio recebe UMA preventiva por mês,
// feita pelo(s) técnico(s) de especialidade "preventiva", com atendimento de
// segunda a domingo. Hoje são ~70 condomínios e 1 técnico de preventiva —
// em expansão, então nada aqui assume esses números.
//
// Como distribui:
// 1. Condomínio que já tem preventiva no mês (qualquer status menos
//    cancelada) fica de fora — rodar o planejamento de novo não duplica.
// 2. Cadência estável: quem teve preventiva antes volta no MESMO dia do mês
//    (de preferência com o mesmo técnico, se ele continua na preventiva), pra
//    o intervalo entre visitas ficar perto de 30 dias. Se o dia lotou pra
//    todos os técnicos, vai pro dia mais próximo com vaga.
// 3. Condomínio sem histórico preenche os dias menos carregados, em ordem
//    alfabética — na prática, um rodízio que espalha a carga pelo mês.
// 4. Capacidade por técnico por dia = teto(total / (dias × técnicos)), então
//    nenhum dia fica com o dobro de outro; e por técnico no mês =
//    teto(total / técnicos) — quando entra um 2º técnico de preventiva, a
//    carga se divide (o histórico não prende tudo no 1º). Quem muda de
//    técnico continua no mesmo dia do mês.
// 5. Mês corrente: só agenda de hoje em diante.
import type { OS } from './db';
import { somarDias } from './os-agenda';

export interface ItemPlano {
  condominio_id: string;
  tecnico_id: string;
  data: string; // YYYY-MM-DD
}

export interface ResultadoPlano {
  itens: ItemPlano[];
  /** Condomínios que já tinham preventiva no mês e foram mantidos. */
  jaAgendados: number;
  /** Dias disponíveis considerados (YYYY-MM-DD). */
  dias: string[];
  /** Máximo de visitas por técnico por dia usado no cálculo. */
  capacidadeDia: number;
}

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

export function planejarPreventivasMes({
  mes,
  hoje,
  condominios,
  tecnicos,
  oss,
}: {
  mes: string;
  hoje: string;
  condominios: { id: string; nome: string }[];
  /** Ids dos técnicos de preventiva ativos. */
  tecnicos: string[];
  /** Todas as OS (o histórico de preventivas sai daqui). */
  oss: Pick<OS, 'condominio_id' | 'tipo' | 'status' | 'data_programada' | 'tecnico_id'>[];
}): ResultadoPlano {
  const dias = diasDoMes(mes, hoje.startsWith(mes) ? hoje : undefined);
  const vazio = { itens: [], jaAgendados: 0, dias, capacidadeDia: 0 };
  if (dias.length === 0 || tecnicos.length === 0) return vazio;

  const preventivas = oss.filter((o) => o.tipo === 'preventiva' && o.status !== 'cancelada' && o.data_programada);
  const carga = new Map<string, number>(); // `${tecnico}|${dia}` → visitas
  const chave = (t: string, d: string) => `${t}|${d}`;
  const comPreventivaNoMes = new Set<string>();
  for (const o of preventivas) {
    if (!o.data_programada!.startsWith(mes)) continue;
    comPreventivaNoMes.add(o.condominio_id);
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

  const pendentes = condominios.filter((c) => !comPreventivaNoMes.has(c.id));
  const jaNoPeriodo = [...carga.values()].reduce((a, b) => a + b, 0);
  const capacidadeDia = Math.max(1, Math.ceil((pendentes.length + jaNoPeriodo) / (dias.length * tecnicos.length)));
  const capacidadeMes = Math.ceil((pendentes.length + jaNoPeriodo) / tecnicos.length);

  const cargaTotal = (t: string) => dias.reduce((acc, d) => acc + (carga.get(chave(t, d)) ?? 0), 0);
  const ocupar = (t: string, d: string) => carga.set(chave(t, d), (carga.get(chave(t, d)) ?? 0) + 1);
  const temVaga = (t: string, d: string) =>
    (carga.get(chave(t, d)) ?? 0) < capacidadeDia && cargaTotal(t) < capacidadeMes;

  // Com histórico primeiro (pela posição no mês), depois os novos por nome.
  const comHistorico = pendentes
    .filter((c) => ultima.has(c.id))
    .sort((a, b) => ultima.get(a.id)!.dia - ultima.get(b.id)!.dia || a.nome.localeCompare(b.nome, 'pt-BR'));
  const novos = pendentes.filter((c) => !ultima.has(c.id)).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));

  const itens: ItemPlano[] = [];

  for (const c of comHistorico) {
    const hist = ultima.get(c.id)!;
    const alvo = Math.min(hist.dia, diaDoMes(dias[dias.length - 1]));
    // Dias por distância do dia de sempre (empate: o mais cedo).
    const porDistancia = [...dias].sort(
      (a, b) => Math.abs(diaDoMes(a) - alvo) - Math.abs(diaDoMes(b) - alvo) || a.localeCompare(b)
    );
    const ordemTecnicos = [...tecnicos].sort((a, b) =>
      a === hist.tecnico ? -1 : b === hist.tecnico ? 1 : cargaTotal(a) - cargaTotal(b)
    );
    // Manter o DIA (intervalo de ~30 dias entre visitas) vale mais que manter
    // o técnico: no dia de sempre, tenta o técnico de sempre e depois os
    // outros; só então passa pro dia vizinho.
    let escolhido: ItemPlano | null = null;
    for (const d of porDistancia) {
      const t = ordemTecnicos.find((tec) => temVaga(tec, d));
      if (t) { escolhido = { condominio_id: c.id, tecnico_id: t, data: d }; break; }
    }
    // Capacidade é teto da média, então sempre há vaga; fallback por garantia.
    escolhido ??= { condominio_id: c.id, tecnico_id: ordemTecnicos[0], data: porDistancia[0] };
    ocupar(escolhido.tecnico_id, escolhido.data);
    itens.push(escolhido);
  }

  for (const c of novos) {
    let melhor: { t: string; d: string; carga: number } | null = null;
    // Técnico menos carregado no mês; dentro dele, o dia mais vazio (empate:
    // o mais cedo) — na prática um rodízio que espalha a carga pelo mês.
    const t = [...tecnicos].sort((a, b) => cargaTotal(a) - cargaTotal(b))[0];
    for (const d of dias) {
      const cg = carga.get(chave(t, d)) ?? 0;
      if (!melhor || cg < melhor.carga) melhor = { t, d, carga: cg };
    }
    ocupar(melhor!.t, melhor!.d);
    itens.push({ condominio_id: c.id, tecnico_id: melhor!.t, data: melhor!.d });
  }

  itens.sort((a, b) => a.data.localeCompare(b.data));
  return { itens, jaAgendados: comPreventivaNoMes.size, dias, capacidadeDia };
}
