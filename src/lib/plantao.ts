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
// Puro (sem I/O): usado pelo servidor (notificacao-corretiva.ts, resumo
// diário) e pela tela de Usuários/painel.
import type { User } from './db';
import { periodoAtendimento, type PeriodoAtendimento } from './horario-comercial';

export function atendeCorretiva(u: Pick<User, 'papel' | 'especialidade' | 'ativo'>): boolean {
  return u.ativo && u.papel === 'tecnico' && u.especialidade !== 'preventiva';
}

export function plantonistas<T extends Pick<User, 'papel' | 'especialidade' | 'ativo' | 'de_plantao'>>(users: T[]): T[] {
  return users.filter((u) => atendeCorretiva(u) && u.de_plantao);
}

// Canal de aviso: Telegram cadastrado OU notificação do app ligada em algum
// aparelho (`comApp` = ids de quem tem inscrição ativa, ver src/lib/push.ts).
// Quem não tem nenhum dos dois não recebe aviso: a tela manda ligar.
export function temCanalDeAviso(
  u: Pick<User, 'id' | 'telegram_chat_id'>,
  comApp?: ReadonlySet<string>
): boolean {
  return !!u.telegram_chat_id || !!comApp?.has(u.id);
}

export type MotivoAviso = 'atribuida' | 'comercial' | 'plantao' | 'plantao_vazio';

export interface EscolhaAviso<T> {
  /** Quem recebe no Telegram (só quem tem Telegram cadastrado). */
  destinatarios: T[];
  /** Todos os alvos do aviso, com ou sem canal. O app recebe os que têm notificação ligada. */
  alvos: T[];
  /** Nomes de quem está de plantão; vazio = ninguém marcado (aviso a todos). Só preenchido no período de plantão. */
  plantao: string[];
  /** Plantonistas sem Telegram nem app — o aviso não chega neles; a tela alerta. */
  plantaoSemTelegram: string[];
  /** Comercial ou plantão, no momento do aviso. */
  periodo: PeriodoAtendimento;
  /** Por que os técnicos foram escolhidos assim (ver cabeçalho do arquivo). */
  motivo: MotivoAviso;
  /** Técnicos-alvo do aviso que de fato recebem (Telegram ou app). Zero = nenhum técnico foi avisado. */
  tecnicosAvisados: number;
  /** Técnicos-alvo sem Telegram nem app, no horário comercial e no plantão vazio (no plantão com marcado, é `plantaoSemTelegram`). */
  tecnicosSemTelegram: string[];
  /** Quando `motivo = atribuida`: o técnico dono da OS. `semTelegram` = sem Telegram nem app. */
  atribuido?: { id: string; nome: string; semTelegram: boolean };
}

export interface OpcoesAviso {
  /** Momento do aviso (testes); padrão = agora. */
  agora?: Date;
  /** OS já tem técnico: o aviso vai só para ele (+ gestores e secretária). */
  tecnicoId?: string | null;
  /** Quem tem notificação do app ligada. Sem isto, só o Telegram conta como canal. */
  comApp?: ReadonlySet<string>;
}

export function escolherDestinatarios<
  T extends Pick<User, 'id' | 'nome' | 'papel' | 'especialidade' | 'ativo' | 'de_plantao' | 'telegram_chat_id'>,
>(users: T[], opcoes: OpcoesAviso = {}): EscolhaAviso<T> {
  const periodo = periodoAtendimento(opcoes.agora);
  // Secretária também é avisada (19/11): é quem atende o telefone e precisa
  // saber que a corretiva abriu — junto com os gestores, sempre.
  const gestores = users.filter((u) => u.ativo && (u.papel === 'admin' || u.papel === 'secretaria'));
  const comTelegram = (lista: T[]) => lista.filter((u) => u.telegram_chat_id);
  const comCanal = (lista: T[]) => lista.filter((u) => temCanalDeAviso(u, opcoes.comApp));

  // Técnico já definido (e ainda ativo): só ele, mais o escritório.
  const dono = opcoes.tecnicoId ? users.find((u) => u.id === opcoes.tecnicoId && u.ativo && u.papel === 'tecnico') : undefined;
  if (dono) {
    return {
      destinatarios: comTelegram([...gestores, dono]),
      alvos: [...gestores, dono],
      plantao: [],
      plantaoSemTelegram: [],
      tecnicosAvisados: temCanalDeAviso(dono, opcoes.comApp) ? 1 : 0,
      tecnicosSemTelegram: [],
      periodo,
      motivo: 'atribuida',
      atribuido: { id: dono.id, nome: dono.nome, semTelegram: !temCanalDeAviso(dono, opcoes.comApp) },
    };
  }

  const todos = users.filter(atendeCorretiva);
  if (periodo === 'comercial') {
    return {
      destinatarios: comTelegram([...gestores, ...todos]),
      alvos: [...gestores, ...todos],
      plantao: [],
      plantaoSemTelegram: [],
      tecnicosAvisados: comCanal(todos).length,
      tecnicosSemTelegram: todos.filter((u) => !temCanalDeAviso(u, opcoes.comApp)).map((u) => u.nome),
      periodo,
      motivo: 'comercial',
    };
  }

  const dePlantao = plantonistas(users);
  const tecnicos = dePlantao.length > 0 ? dePlantao : todos;
  return {
    destinatarios: comTelegram([...gestores, ...tecnicos]),
    alvos: [...gestores, ...tecnicos],
    plantao: dePlantao.map((u) => u.nome),
    plantaoSemTelegram: dePlantao.filter((u) => !temCanalDeAviso(u, opcoes.comApp)).map((u) => u.nome),
    tecnicosAvisados: comCanal(tecnicos).length,
    tecnicosSemTelegram: dePlantao.length > 0 ? [] : tecnicos.filter((u) => !temCanalDeAviso(u, opcoes.comApp)).map((u) => u.nome),
    periodo,
    motivo: dePlantao.length > 0 ? 'plantao' : 'plantao_vazio',
  };
}
