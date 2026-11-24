// Quem é avisado de corretiva. Gestores (admin) e secretária são avisados
// SEMPRE. Os técnicos dependem do caso (regra do Dm, 20/11):
//   - OS já com técnico (aberta atribuída, ou o escritório atribuiu/trocou):
//     só esse técnico — os outros não precisam acordar à toa;
//   - sem técnico, em HORÁRIO COMERCIAL (src/lib/horario-comercial.ts): todos
//     os técnicos de corretiva; quem estiver mais perto assume a OS;
//   - sem técnico, fora do horário comercial (plantão): só o(s)
//     plantonista(s) marcado(s) pelo supervisor (os técnicos trabalham em
//     plantões intercalados). Se ninguém estiver marcado, vai pra todos os
//     técnicos de corretiva — melhor acordar todo mundo do que ninguém — e a
//     tela avisa o escritório que não há plantonista.
//
// Quem está de plantão (22/11): a ESCALA manda; sem período cobrindo o
// instante, vale a marca manual (`de_plantao`). Tudo que precisa saber quem
// está de plantão (aviso de corretiva, resumo diário, card "Plantão agora")
// pergunta a `plantonistasEm`.
//
// Puro (sem I/O): usado pelo servidor (notificacao-corretiva.ts, resumo
// diário) e pela tela de Usuários/painel.
import type { PlantaoEscala, User } from './db';
import { periodoAtendimento, type PeriodoAtendimento } from './horario-comercial';

/** Um período da escala (o que `plantonistasEm` precisa; as datas são instantes ISO). */
export type PeriodoEscala = Pick<PlantaoEscala, 'usuario_id' | 'inicio' | 'fim'>;

// Canal de aviso = por onde a pessoa recebe a corretiva. Hoje é o Telegram.
// Quando o app ganhar notificação própria, é só acrescentar a condição aqui:
// a marcação de plantão (manual e na escala) e o aviso já passam por este
// helper.
export function temCanalDeAviso(u: Pick<User, 'telegram_chat_id'>): boolean {
  return !!u.telegram_chat_id;
}

/**
 * Confere se a pessoa pode entrar no plantão (manual ou na escala): precisa ter
 * canal de aviso. Devolve a mensagem de recusa ou null.
 */
export function erroParaPlantao(u: Pick<User, 'nome' | 'telegram_chat_id'>): string | null {
  return temCanalDeAviso(u) ? null : mensagemSemCanalDeAviso(u.nome);
}

/** Texto único da recusa de plantão para quem não tem canal de aviso. */
export function mensagemSemCanalDeAviso(nome: string): string {
  return `Cadastre o Telegram de ${nome} em Usuários antes de colocá-lo de plantão.`;
}

export function atendeCorretiva(u: Pick<User, 'papel' | 'especialidade' | 'ativo'>): boolean {
  return u.ativo && u.papel === 'tecnico' && u.especialidade !== 'preventiva';
}

// Marca manual (card "Plantão agora"): só vale quando a escala não cobre o instante.
function marcadosAMao<T extends Pick<User, 'papel' | 'especialidade' | 'ativo' | 'de_plantao'>>(users: T[]): T[] {
  return users.filter((u) => atendeCorretiva(u) && u.de_plantao);
}

export interface PlantonistasEm<T> {
  usuarios: T[];
  /** 'escala' = há período cobrindo o instante; 'manual' = vale o `de_plantao` marcado à mão. */
  origem: 'escala' | 'manual';
  /** Só na escala: id do plantonista → quando o período dele termina (ISO). Períodos emendados contam como um só. */
  ate: Record<string, string>;
}

/**
 * Quem está de plantão em `agora`. Função única (22/11):
 *  - período da escala cobrindo o instante (inicio <= agora < fim) manda; pode
 *    haver mais de uma pessoa no mesmo intervalo. Só conta quem ainda é técnico
 *    de corretiva e está ativo;
 *  - sem nenhum período válido cobrindo o instante, vale o `de_plantao` manual
 *    (o comportamento de antes da escala).
 * Na virada (fim de um período = início do outro) vale o novo: o fim é exclusivo.
 */
export function plantonistasEm<T extends Pick<User, 'id' | 'papel' | 'especialidade' | 'ativo' | 'de_plantao'>>(
  agora: Date,
  escala: PeriodoEscala[],
  users: T[]
): PlantonistasEm<T> {
  const t = agora.getTime();
  const porId = new Map(users.filter(atendeCorretiva).map((u) => [u.id, u]));
  const ate: Record<string, string> = {};
  const fimDe: Record<string, number> = {};
  for (const p of escala) {
    const i = new Date(p.inicio).getTime();
    const f = new Date(p.fim).getTime();
    if (!(i <= t && t < f) || !porId.has(p.usuario_id)) continue;
    // Do mesmo plantonista, vale o fim mais tarde.
    if (fimDe[p.usuario_id] === undefined || f > fimDe[p.usuario_id]) {
      fimDe[p.usuario_id] = f;
      ate[p.usuario_id] = p.fim;
    }
  }
  const ids = Object.keys(ate);
  if (ids.length === 0) return { usuarios: marcadosAMao(users), origem: 'manual', ate: {} };
  // Períodos emendados do mesmo plantonista (rodízio com a mesma pessoa em
  // semanas seguidas): o "até" segue até onde a cadeia continua.
  for (const id of ids) {
    let fim = fimDe[id];
    for (let mudou = true; mudou; ) {
      mudou = false;
      for (const p of escala) {
        if (p.usuario_id !== id) continue;
        const i = new Date(p.inicio).getTime();
        const f = new Date(p.fim).getTime();
        if (i <= fim && f > fim) { fim = f; ate[id] = p.fim; mudou = true; }
      }
    }
  }
  return { usuarios: ids.map((id) => porId.get(id)!), origem: 'escala', ate };
}

export type MotivoAviso = 'atribuida' | 'comercial' | 'plantao' | 'plantao_vazio';

export interface EscolhaAviso<T> {
  /** Quem recebe (só quem tem Telegram). */
  destinatarios: T[];
  /** Nomes de quem está de plantão; vazio = ninguém marcado (aviso a todos). Só preenchido no período de plantão. */
  plantao: string[];
  /** Plantonistas sem Telegram — o aviso não chega neles; a tela alerta. */
  plantaoSemTelegram: string[];
  /** Comercial ou plantão, no momento do aviso. */
  periodo: PeriodoAtendimento;
  /** Por que os técnicos foram escolhidos assim (ver cabeçalho do arquivo). */
  motivo: MotivoAviso;
  /** Técnicos-alvo do aviso que de fato recebem (têm Telegram). Zero = nenhum técnico foi avisado. */
  tecnicosAvisados: number;
  /** Técnicos-alvo sem Telegram, no horário comercial e no plantão vazio (no plantão com marcado, é `plantaoSemTelegram`). */
  tecnicosSemTelegram: string[];
  /** Quando `motivo = atribuida`: o técnico dono da OS. */
  atribuido?: { id: string; nome: string; semTelegram: boolean };
}

export interface OpcoesAviso {
  /** Momento do aviso (testes); padrão = agora. */
  agora?: Date;
  /** Escala de plantão (Database.getPlantaoEscala); ausente = só a marca manual. */
  escala?: PeriodoEscala[];
  /** OS já tem técnico: o aviso vai só para ele (+ gestores e secretária). */
  tecnicoId?: string | null;
}

export function escolherDestinatarios<
  T extends Pick<User, 'id' | 'nome' | 'papel' | 'especialidade' | 'ativo' | 'de_plantao' | 'telegram_chat_id'>,
>(users: T[], opcoes: OpcoesAviso = {}): EscolhaAviso<T> {
  const agora = opcoes.agora ?? new Date();
  const periodo = periodoAtendimento(agora);
  // Secretária também é avisada (19/11): é quem atende o telefone e precisa
  // saber que a corretiva abriu — junto com os gestores, sempre.
  const gestores = users.filter((u) => u.ativo && (u.papel === 'admin' || u.papel === 'secretaria'));
  const comTelegram = (lista: T[]) => lista.filter(temCanalDeAviso);

  // Técnico já definido (e ainda ativo): só ele, mais o escritório.
  const dono = opcoes.tecnicoId ? users.find((u) => u.id === opcoes.tecnicoId && u.ativo && u.papel === 'tecnico') : undefined;
  if (dono) {
    return {
      destinatarios: comTelegram([...gestores, dono]),
      plantao: [],
      plantaoSemTelegram: [],
      tecnicosAvisados: temCanalDeAviso(dono) ? 1 : 0,
      tecnicosSemTelegram: [],
      periodo,
      motivo: 'atribuida',
      atribuido: { id: dono.id, nome: dono.nome, semTelegram: !temCanalDeAviso(dono) },
    };
  }

  const todos = users.filter(atendeCorretiva);
  if (periodo === 'comercial') {
    return {
      destinatarios: comTelegram([...gestores, ...todos]),
      plantao: [],
      plantaoSemTelegram: [],
      tecnicosAvisados: comTelegram(todos).length,
      tecnicosSemTelegram: todos.filter((u) => !temCanalDeAviso(u)).map((u) => u.nome),
      periodo,
      motivo: 'comercial',
    };
  }

  const dePlantao = plantonistasEm(agora, opcoes.escala ?? [], users).usuarios;
  const tecnicos = dePlantao.length > 0 ? dePlantao : todos;
  return {
    destinatarios: comTelegram([...gestores, ...tecnicos]),
    plantao: dePlantao.map((u) => u.nome),
    plantaoSemTelegram: dePlantao.filter((u) => !temCanalDeAviso(u)).map((u) => u.nome),
    tecnicosAvisados: comTelegram(tecnicos).length,
    tecnicosSemTelegram: dePlantao.length > 0 ? [] : tecnicos.filter((u) => !temCanalDeAviso(u)).map((u) => u.nome),
    periodo,
    motivo: dePlantao.length > 0 ? 'plantao' : 'plantao_vazio',
  };
}
