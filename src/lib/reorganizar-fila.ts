// Reorganização da fila de preventivas de um técnico — função pura, sem I/O.
//
// Regra (Dm, 20/11): o que não foi feito não acumula. A preventiva aberta
// que ficou pra trás entra PRIMEIRO na rota do próximo dia útil e a fila
// anda: nenhum dia útil passa da meta do técnico (sobras + as que já eram do
// dia); o excedente desliza para o dia útil seguinte, e assim por diante.
//
// - Só preventiva aberta (nem iniciada, nem finalizada, nem cancelada).
//   Corretiva nunca muda de data.
// - Só empurra pra frente: nada é puxado pra um dia anterior (a cadência do
//   planejamento mensal fica como está onde há folga).
// - Preventiva já feita/iniciada no dia ocupa vaga da meta daquele dia.
// - Data em dia não útil (ex.: sábado marcado à mão) não é mexida, a não ser
//   que seja sobra (data anterior ao início da fila).
// - Idempotente: depois de aplicada, rodar de novo no mesmo dia não muda nada.
// - Nunca atravessa o mês: a preventiva de novembro não vira a de dezembro
//   (o planejamento e o painel contam por mês da data). O que não cabe até o
//   último dia útil do mês fica nele, acima da meta (`acimaDaMeta`); a sobra
//   cujo mês já acabou fica onde está (atrasada) em vez de pular de mês.
import type { OS } from './db';
import { DIAS_UTEIS_PREVENTIVA, diaUtilApartirDe, ehDiaUtil, proximoDiaUtil, somarDias } from './os-agenda';

export interface MovimentoFila {
  os_id: string;
  de: string; // YYYY-MM-DD
  para: string; // YYYY-MM-DD
  /** Não coube na meta até o fim do mês: ficou no último dia útil, acima dela. */
  acimaDaMeta?: boolean;
}

export interface OpcoesFila {
  /**
   * Execução manual no meio do expediente: o que já é de hoje fica em hoje
   * (conta como vaga ocupada) e as sobras só preenchem as vagas livres.
   * A rotina das 5h não usa: ali hoje ainda é o começo da fila.
   */
  manterHoje?: boolean;
}

type OsFila = Pick<OS, 'id' | 'tipo' | 'status' | 'data_programada' | 'tecnico_id' | 'entrada_em'>;

/** Preventiva ainda por fazer: aberta, sem chegada registrada. */
export function preventivaAberta(os: OsFila): boolean {
  return os.tipo === 'preventiva' && os.status === 'aberta' && !os.entrada_em;
}

// Trava de segurança do laço (dias de calendário à frente).
const LIMITE_DIAS = 800;

export function reorganizarFila(
  oss: OsFila[],
  tecnicoId: string,
  hoje: string,
  meta: number,
  diasUteis: readonly number[] = DIAS_UTEIS_PREVENTIVA,
  opcoes: OpcoesFila = {}
): MovimentoFila[] {
  if (diasUteis.length === 0 || meta < 1) return [];
  const doTecnico = oss.filter((o) => o.tecnico_id === tecnicoId && o.tipo === 'preventiva' && o.data_programada);

  // A fila começa no primeiro dia útil a partir de hoje.
  const inicio = diaUtilApartirDe(hoje, diasUteis);

  const manterHoje = !!opcoes.manterHoje && inicio === hoje;
  // Sobra de mês anterior ao do início da fila não pula de mês: fica onde está.
  const abertas = doTecnico.filter(preventivaAberta).filter((o) => o.data_programada! >= inicio || o.data_programada!.slice(0, 7) === inicio.slice(0, 7));
  // Vagas já tomadas por quem foi iniciado/feito no dia (cancelada não conta);
  // na execução manual, as abertas de hoje também ficam com a vaga de hoje.
  const ocupadas = new Map<string, number>();
  const ocupa = (d: string) => ocupadas.set(d, (ocupadas.get(d) ?? 0) + 1);
  for (const o of doTecnico) {
    if (o.status === 'cancelada') continue;
    if (preventivaAberta(o)) {
      if (manterHoje && o.data_programada === hoje) ocupa(hoje);
      continue;
    }
    ocupa(o.data_programada!);
  }

  // Ordem estável: data, depois id — o resultado não depende da ordem de entrada.
  const porDataEId = (a: OsFila, b: OsFila) => a.data_programada!.localeCompare(b.data_programada!) || a.id.localeCompare(b.id);
  const sobras = abertas.filter((o) => o.data_programada! < inicio).sort(porDataEId);
  const futuras = abertas.filter((o) => o.data_programada! >= inicio && !(manterHoje && o.data_programada === hoje)).sort(porDataEId);
  if (sobras.length === 0 && futuras.length === 0) return [];

  const ultimaData = [...sobras, ...futuras].reduce((max, o) => (o.data_programada! > max ? o.data_programada! : max), inicio);
  const movimentos: MovimentoFila[] = [];
  let vaiParaFrente: OsFila[] = sobras; // quem está esperando vaga, na ordem

  for (let d = inicio, n = 0; n < LIMITE_DIAS; d = somarDias(d, 1), n++) {
    if (vaiParaFrente.length === 0 && d > ultimaData) break;
    if (!ehDiaUtil(d, diasUteis)) continue; // fim de semana não recebe sobra nem desliza

    const doDia = futuras.filter((o) => o.data_programada === d);
    const fila = [...vaiParaFrente, ...doDia]; // sobras primeiro
    const vagas = Math.max(0, meta - (ocupadas.get(d) ?? 0));
    // Último dia útil do mês: o que sobrou fica aqui, acima da meta.
    const ultimoDoMes = proximoDiaUtil(d, diasUteis).slice(0, 7) !== d.slice(0, 7);
    const ficam = ultimoDoMes ? fila : fila.slice(0, vagas);
    vaiParaFrente = ultimoDoMes ? [] : fila.slice(vagas);

    const estoura = ficam.length > vagas;
    for (const o of ficam) {
      if (o.data_programada === d) continue;
      movimentos.push({ os_id: o.id, de: o.data_programada!, para: d, ...(estoura ? { acimaDaMeta: true } : {}) });
    }
  }
  // Se o laço esgotou o limite sem acomodar tudo (meta/ocupação absurdas), o
  // que sobrou fica onde está: melhor não mexer do que perder a OS.
  return movimentos;
}
