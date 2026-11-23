// Aviso operacional de corretiva (regra da Amotex, 23/10): toda corretiva é
// urgente, com 3h pra chegada — técnicos de corretiva e gestores são
// avisados na ABERTURA, e de novo quando alguém ASSUME (pra dois técnicos
// não irem ao mesmo chamado). Quem são os técnicos avisados depende de
// horário comercial x plantão x OS já atribuída (src/lib/plantao.ts).
//
// Quem recebe e o texto saem daqui (o app conhece usuários e OS); o n8n só
// entrega cada `mensagem` no `telegram_chat_id` de cada destinatário — ver
// n8n/workflows/ no repo amotex-prevent-infra. WhatsApp entra depois pelo
// mesmo payload, trocando só o nó de envio no n8n.
//
// Além do Telegram, quem tem a notificação do app ligada (src/lib/push.ts)
// recebe o mesmo aviso no celular. Os destinatários são calculados uma vez;
// o Telegram vai só para quem tem `telegram_chat_id`, o app só para quem tem
// aparelho inscrito.
import { Database, type Condominio, type OS, type User } from './db';
import { notifyN8n, webhookConfigurado } from './notify';
import { fmtHora, slaChegada } from './os-sla';
import type { ResultadoAviso } from './aviso';
import { escaparMarkdown } from './telegram-texto';
import { escolherDestinatarios, plantonistas } from './plantao';
import { enderecoCompleto } from './endereco';
import { enviarPushUsuarios, usuariosComPush } from './push';

export interface Destinatario {
  nome: string;
  papel: User['papel'];
  telegram_chat_id: string;
  /**
   * Texto já ajustado a quem recebe ("Atribuída a você", "Plantão: você está
   * de plantão"). O `mensagem` de cima do payload é a versão geral; o n8n
   * deve preferir esta quando existir.
   */
  mensagem?: string;
}

export type { ResultadoAviso };

// Quem recebe (gestores e secretária sempre; técnicos por horário comercial x
// plantão x atribuição) está em src/lib/plantao.ts. `tecnicoId` = OS já tem
// técnico: o aviso vai só pra ele.
export async function destinatariosCorretiva(tecnicoId?: string | null, agora?: Date) {
  return escolherDestinatarios(await Database.getUsers(), { tecnicoId, agora });
}

function linkOs(osId: string): string | undefined {
  const base = process.env.APP_URL?.replace(/\/$/, '');
  return base ? `${base}/?os=${osId}` : undefined;
}

// `para` = quem lê a mensagem, quando dá pra personalizar o motivo:
// 'tecnico' (o técnico dono da OS) ou 'plantonista'. Sem `para`, texto geral.
export interface ContextoAviso {
  periodo?: 'comercial' | 'plantao';
  para?: 'tecnico' | 'plantonista';
}

export function mensagemCorretivaAberta(
  os: OS,
  condominio: Condominio,
  tecnico?: User | null,
  plantao: string[] = [],
  ctx: ContextoAviso = {}
): string {
  const sla = slaChegada(os);
  let quemAtende: string;
  if (tecnico) {
    quemAtende = ctx.para === 'tecnico' ? 'Atribuída a você' : `Técnico: ${escaparMarkdown(tecnico.nome)}`;
  } else if (ctx.periodo === 'comercial') {
    quemAtende = 'Horário comercial — quem estiver mais perto, assuma a OS no sistema';
  } else if (plantao.length > 0) {
    quemAtende =
      ctx.para === 'plantonista'
        ? 'Plantão: você está de plantão — assuma a OS no sistema'
        : `De plantão: ${escaparMarkdown(plantao.join(', '))} — assuma a OS no sistema`;
  } else {
    quemAtende = 'Técnico: ninguém ainda (sem plantonista marcado) — quem for, assuma a OS no sistema';
  }
  const linhas = [
    `*CORRETIVA URGENTE* — ${escaparMarkdown(condominio.nome)}`,
    escaparMarkdown(enderecoCompleto(condominio)),
    os.descricao_problema && `Problema: ${escaparMarkdown(os.descricao_problema)}`,
    (os.solicitante_nome || os.solicitante_telefone) &&
      `Solicitante: ${escaparMarkdown([os.solicitante_nome, os.solicitante_telefone].filter(Boolean).join(' · '))}`,
    quemAtende,
    sla && `Chegar até ${fmtHora(sla.prazo)} (prazo de 3h)`,
    linkOs(os.id),
  ];
  // Só o que vem de cadastro é escapado (acima); os '*' do título são do template.
  // A URL também não é escapada: o '_' escapado quebraria o link.
  return linhas.filter(Boolean).join('\n');
}

export function mensagemCorretivaAssumida(os: OS, condominio: Condominio, tecnico: User): string {
  const sla = slaChegada(os);
  return [
    `*Corretiva assumida* — ${escaparMarkdown(tecnico.nome)} — ${escaparMarkdown(condominio.nome)}`,
    sla && `Chegar até ${fmtHora(sla.prazo)}`,
    linkOs(os.id),
  ]
    .filter(Boolean)
    .join('\n');
}

// aberta     = OS acabou de abrir (com ou sem técnico);
// atribuida  = o ESCRITÓRIO atribuiu/trocou o técnico — só ele (+ gestores e
//              secretária) recebe;
// assumida   = o TÉCNICO assumiu sozinho — vai pro grupo que recebeu a
//              abertura, pros outros saberem que alguém já vai.
export type EventoAvisoCorretiva = 'os_corretiva_aberta' | 'os_corretiva_atribuida' | 'os_corretiva_assumida';

// Quem recebeu a ÚLTIMA abertura desta OS (ids gravados na auditoria). O aviso
// de "assumida" usa essa lista exata: o período ou o plantonista podem ter
// mudado entre a abertura e o assumir. Sem registro (OS antiga), undefined.
async function idsDaAbertura(osId: string): Promise<Set<string> | undefined> {
  const logs = await Database.getAuditLogsByEntidade('os', osId); // mais recente primeiro
  const ids = (logs.find((l) => l.acao === 'AVISO_ABERTURA')?.detalhe as { ids?: unknown } | undefined)?.ids;
  return Array.isArray(ids) ? new Set(ids.filter((i): i is string => typeof i === 'string')) : undefined;
}

// Texto do aviso no celular: sem Markdown, curto (a barra de notificações corta).
function textoPush(
  evento: EventoAvisoCorretiva,
  os: OS,
  condominio: Condominio,
  tecnico: User | null,
  contexto: { periodo?: 'comercial' | 'plantao'; para?: ContextoAviso['para'] }
): { titulo: string; corpo: string } {
  const sla = slaChegada(os);
  const chegar = sla ? `Chegar até ${fmtHora(sla.prazo)}` : '';
  if (evento === 'os_corretiva_assumida') {
    return {
      titulo: `${tecnico?.nome ?? 'Um técnico'} assumiu a corretiva`,
      corpo: [condominio.nome, chegar].filter(Boolean).join('\n'),
    };
  }
  let quem = '';
  if (tecnico) {
    quem = contexto.para === 'tecnico' ? 'Atribuída a você' : `Técnico: ${tecnico.nome}`;
  } else if (contexto.periodo === 'comercial') {
    quem = 'Quem estiver mais perto, assuma a OS no sistema';
  } else if (contexto.para === 'plantonista') {
    quem = 'Você está de plantão. Assuma a OS no sistema';
  } else {
    quem = 'Assuma a OS no sistema';
  }
  return {
    titulo:
      evento === 'os_corretiva_atribuida' && contexto.para === 'tecnico'
        ? `Corretiva atribuída a você — ${condominio.nome}`
        : `Corretiva urgente — ${condominio.nome}`,
    corpo: [os.descricao_problema, quem, chegar].filter(Boolean).join('\n'),
  };
}

export interface OpcoesAvisoCorretiva {
  /** Quem acionou e não precisa ser avisado (o técnico que abriu a corretiva já atribuída a ele). */
  ignorarId?: string;
}

export async function avisarCorretiva(
  evento: EventoAvisoCorretiva,
  os: OS,
  opcoes: OpcoesAvisoCorretiva = {}
): Promise<ResultadoAviso> {
  if (os.tipo !== 'corretiva') return { enviado: false, destinatarios: 0, motivo: 'não é corretiva' };
  const [condominio, tecnico, usuarios] = await Promise.all([
    Database.getCondominioById(os.condominio_id),
    os.tecnico_id ? Database.getUserById(os.tecnico_id) : Promise.resolve(null),
    Database.getUsers(),
  ]);
  if (!condominio) return { enviado: false, destinatarios: 0, motivo: 'condomínio não encontrado' };

  // Assumida: o grupo que recebeu a abertura — a lista gravada na auditoria;
  // sem ela, recalcula pelo momento em que a OS abriu (não o de agora).
  // Aberta/atribuída com técnico: só ele (+ gestores e secretária).
  const assumida = evento === 'os_corretiva_assumida';
  const comApp = await usuariosComPush();
  // Sem o webhook do n8n o Telegram não existe: ninguém conta como "com Telegram".
  const telegramAtivo = webhookConfigurado();
  const usuariosCanal = telegramAtivo ? usuarios : usuarios.map((u) => ({ ...u, telegram_chat_id: undefined }));
  const escolha = escolherDestinatarios(usuariosCanal, {
    tecnicoId: assumida ? null : os.tecnico_id,
    agora: assumida ? new Date(os.criado_em) : undefined,
    comApp,
  });
  const { periodo, motivo: porQue, atribuido } = escolha;
  // Plantão/alertas de Telegram só dizem respeito a quem abre ou atribui: quem assume não resolve isso.
  const plantao = assumida ? [] : escolha.plantao;
  const plantaoSemTelegram = assumida ? [] : escolha.plantaoSemTelegram;
  let lista = escolha.destinatarios; // Telegram
  let alvos = escolha.alvos; // todos os alvos (app: quem tem aparelho inscrito)
  if (assumida) {
    const ids = await idsDaAbertura(os.id);
    if (ids) {
      lista = usuariosCanal.filter((u) => ids.has(u.id) && u.telegram_chat_id);
      alvos = usuariosCanal.filter((u) => ids.has(u.id));
    }
  }
  if (opcoes.ignorarId) {
    lista = lista.filter((u) => u.id !== opcoes.ignorarId);
    alvos = alvos.filter((u) => u.id !== opcoes.ignorarId);
  }
  // No celular: quem tem o app ligado. Atribuída pelo escritório vai só pro
  // técnico (gestores e secretária já sabem: foram eles); quem assumiu não
  // precisa de aviso do que ele mesmo fez.
  let alvosApp = alvos.filter((u) => comApp.has(u.id));
  if (evento === 'os_corretiva_atribuida') alvosApp = alvosApp.filter((u) => u.id === os.tecnico_id);
  if (assumida) alvosApp = alvosApp.filter((u) => u.id !== os.tecnico_id);

  if (lista.length === 0 && alvosApp.length === 0) {
    return {
      enviado: false,
      destinatarios: 0,
      motivo: telegramAtivo
        ? 'ninguém com Telegram cadastrado nem com o app ligado, em Usuários'
        : 'aviso por Telegram ainda não configurado no servidor e ninguém com o app ligado',
    };
  }
  if (evento === 'os_corretiva_assumida' && !tecnico) {
    return { enviado: false, destinatarios: 0, motivo: 'OS sem técnico' };
  }

  const ctx: ContextoAviso = { periodo };
  const mensagem =
    evento === 'os_corretiva_assumida'
      ? mensagemCorretivaAssumida(os, condominio, tecnico!)
      : mensagemCorretivaAberta(os, condominio, tecnico, plantao, ctx);

  // Texto de cada um com o motivo dele (só abertura/atribuição muda por pessoa).
  const idsPlantao = new Set(plantonistas(usuarios).map((u) => u.id));
  const paraDe = (u: User): ContextoAviso['para'] => {
    if (evento === 'os_corretiva_assumida') return undefined;
    if (u.id === atribuido?.id) return 'tecnico';
    if (porQue === 'plantao' && idsPlantao.has(u.id)) return 'plantonista';
    return undefined;
  };
  const destinatarios: Destinatario[] = lista.map((u) => {
    const para = paraDe(u);
    return {
      nome: u.nome,
      papel: u.papel,
      telegram_chat_id: u.telegram_chat_id!,
      ...(para ? { mensagem: mensagemCorretivaAberta(os, condominio, tecnico, plantao, { ...ctx, para }) } : {}),
    };
  });

  const sla = slaChegada(os);
  // O n8n só conhece abertura e assumida: a atribuição pelo escritório sai
  // como abertura (o técnico recebe o chamado); `motivo_aviso` diferencia.
  if (destinatarios.length > 0) {
    notifyN8n(evento === 'os_corretiva_assumida' ? 'os_corretiva_assumida' : 'os_corretiva_aberta', os, {
      mensagem,
      destinatarios,
      motivo_aviso: porQue,
      condominio: { nome: condominio.nome, endereco: enderecoCompleto(condominio) },
      tecnico_nome: tecnico?.nome,
      prazo_chegada: sla ? new Date(sla.prazo).toISOString() : undefined,
      link: linkOs(os.id),
    });
  }

  // App: um envio por texto diferente (o técnico dono e o plantonista leem o motivo deles).
  const alcancadosApp = new Set<string>();
  if (alvosApp.length > 0) {
    const grupos = new Map<string, { para: ContextoAviso['para']; ids: string[] }>();
    for (const u of alvosApp) {
      const para = paraDe(u);
      const g = grupos.get(para ?? '') ?? { para, ids: [] };
      g.ids.push(u.id);
      grupos.set(para ?? '', g);
    }
    const url = `/?os=${os.id}`;
    const envios = await Promise.all(
      [...grupos.values()].map((g) => {
        const t = textoPush(evento, os, condominio, tecnico, { periodo, para: g.para });
        return enviarPushUsuarios(g.ids, { titulo: t.titulo, corpo: t.corpo, url, tag: `os-${os.id}` });
      })
    );
    for (const r of envios) r.usuariosAlcancados.forEach((id) => alcancadosApp.add(id));
  }
  const alcancados = new Set<string>([...lista.map((u) => u.id), ...alcancadosApp]);
  if (alcancados.size === 0) {
    return { enviado: false, destinatarios: 0, motivo: 'o aviso no app não chegou a ninguém (aparelhos sem resposta)' };
  }

  await Database.createAuditLog({
    entidade: 'os', entidade_id: os.id,
    acao: evento === 'os_corretiva_aberta' ? 'AVISO_ABERTURA' : evento === 'os_corretiva_atribuida' ? 'AVISO_ATRIBUICAO' : 'AVISO_ASSUMIDA',
    ator: 'sistema',
    detalhe: {
      destinatarios: alvos.filter((u) => alcancados.has(u.id)).map((u) => u.nome),
      // Todos os alvos, não só quem tinha Telegram: o "assumida" reaproveita esta lista.
      ids: alvos.map((u) => u.id),
      telegram: lista.length,
      app: alcancadosApp.size,
      plantao, periodo, motivo: porQue,
    },
  });
  return {
    enviado: true,
    destinatarios: alcancados.size,
    viaTelegram: lista.length,
    viaApp: alcancadosApp.size,
    plantao,
    plantaoSemTelegram,
    periodo,
    semPlantonista: (!assumida && porQue === 'plantao_vazio') || undefined,
    tecnicosSemTelegram: (!assumida && escolha.tecnicosSemTelegram.length > 0 && escolha.tecnicosSemTelegram) || undefined,
    semTecnicos: (!assumida && porQue !== 'atribuida' && escolha.tecnicosAvisados === 0) || undefined,
    atribuidaA: atribuido?.nome,
    atribuidaSemTelegram: atribuido?.semTelegram || undefined,
  };
}
