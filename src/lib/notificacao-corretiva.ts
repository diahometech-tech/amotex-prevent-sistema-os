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
import { Database, type Condominio, type OS, type User } from './db';
import { notifyN8n, webhookConfigurado } from './notify';
import { fmtHora, slaChegada } from './os-sla';
import type { ResultadoAviso } from './aviso';
import { escaparMarkdown } from './telegram-texto';
import { escolherDestinatarios, plantonistas } from './plantao';
import { enderecoCompleto } from './endereco';

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
  const escolha = escolherDestinatarios(usuarios, {
    tecnicoId: assumida ? null : os.tecnico_id,
    agora: assumida ? new Date(os.criado_em) : undefined,
  });
  const { periodo, motivo: porQue, atribuido } = escolha;
  // Plantão/alertas de Telegram só dizem respeito a quem abre ou atribui: quem assume não resolve isso.
  const plantao = assumida ? [] : escolha.plantao;
  const plantaoSemTelegram = assumida ? [] : escolha.plantaoSemTelegram;
  let lista = escolha.destinatarios;
  if (assumida) {
    const ids = await idsDaAbertura(os.id);
    if (ids) lista = usuarios.filter((u) => ids.has(u.id) && u.telegram_chat_id);
  }
  if (opcoes.ignorarId) lista = lista.filter((u) => u.id !== opcoes.ignorarId);

  if (!webhookConfigurado()) {
    return { enviado: false, destinatarios: lista.length, motivo: 'aviso por Telegram ainda não configurado no servidor' };
  }
  if (lista.length === 0) {
    return { enviado: false, destinatarios: 0, motivo: 'ninguém com Telegram cadastrado em Usuários' };
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
  const destinatarios: Destinatario[] = lista.map((u) => {
    let para: ContextoAviso['para'];
    if (evento !== 'os_corretiva_assumida') {
      if (u.id === atribuido?.id) para = 'tecnico';
      else if (porQue === 'plantao' && idsPlantao.has(u.id)) para = 'plantonista';
    }
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
  notifyN8n(evento === 'os_corretiva_assumida' ? 'os_corretiva_assumida' : 'os_corretiva_aberta', os, {
    mensagem,
    destinatarios,
    motivo_aviso: porQue,
    condominio: { nome: condominio.nome, endereco: enderecoCompleto(condominio) },
    tecnico_nome: tecnico?.nome,
    prazo_chegada: sla ? new Date(sla.prazo).toISOString() : undefined,
    link: linkOs(os.id),
  });
  await Database.createAuditLog({
    entidade: 'os', entidade_id: os.id,
    acao: evento === 'os_corretiva_aberta' ? 'AVISO_ABERTURA' : evento === 'os_corretiva_atribuida' ? 'AVISO_ATRIBUICAO' : 'AVISO_ASSUMIDA',
    ator: 'sistema', detalhe: { destinatarios: destinatarios.map((d) => d.nome), ids: lista.map((u) => u.id), plantao, periodo, motivo: porQue },
  });
  return {
    enviado: true,
    destinatarios: destinatarios.length,
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

// Chamado cancelado pelo condomínio (22/11). Sem canal novo: sai pelo mesmo
// evento de abertura (o n8n só entrega cada `mensagem` no Telegram de cada
// destinatário), com `motivo_aviso: 'cancelada_pelo_condominio'`. Recebem o
// técnico da OS (se houver) e quem recebeu a abertura (ids na auditoria).
export function mensagemCorretivaCancelada(os: OS, condominio: Condominio, motivo: string, tecnico?: User | null): string {
  return [
    `*CHAMADO CANCELADO pelo condomínio* — ${escaparMarkdown(condominio.nome)}`,
    `Motivo: ${escaparMarkdown(motivo)}`,
    tecnico && `Técnico: ${escaparMarkdown(tecnico.nome)} — não precisa mais ir`,
    os.descricao_problema && `Chamado: ${escaparMarkdown(os.descricao_problema)}`,
  ]
    .filter(Boolean)
    .join('\n');
}

export async function avisarCancelamentoCorretiva(os: OS, motivo: string): Promise<ResultadoAviso> {
  if (os.tipo !== 'corretiva') return { enviado: false, destinatarios: 0, motivo: 'não é corretiva' };
  const [condominio, tecnico, usuarios, idsAbertura] = await Promise.all([
    Database.getCondominioById(os.condominio_id),
    os.tecnico_id ? Database.getUserById(os.tecnico_id) : Promise.resolve(null),
    Database.getUsers(),
    idsDaAbertura(os.id),
  ]);
  if (!condominio) return { enviado: false, destinatarios: 0, motivo: 'condomínio não encontrado' };
  const ids = new Set<string>(idsAbertura ?? []);
  if (os.tecnico_id) ids.add(os.tecnico_id);
  const lista = usuarios.filter((u) => u.ativo !== false && u.telegram_chat_id && ids.has(u.id));
  if (!webhookConfigurado()) {
    return { enviado: false, destinatarios: lista.length, motivo: 'aviso por Telegram ainda não configurado no servidor' };
  }
  if (lista.length === 0) return { enviado: false, destinatarios: 0, motivo: 'ninguém com Telegram para avisar' };

  const mensagem = mensagemCorretivaCancelada(os, condominio, motivo, tecnico);
  const destinatarios: Destinatario[] = lista.map((u) => ({
    nome: u.nome, papel: u.papel, telegram_chat_id: u.telegram_chat_id!,
  }));
  notifyN8n('os_corretiva_aberta', os, {
    mensagem,
    destinatarios,
    motivo_aviso: 'cancelada_pelo_condominio',
    condominio: { nome: condominio.nome, endereco: enderecoCompleto(condominio) },
    tecnico_nome: tecnico?.nome,
  });
  await Database.createAuditLog({
    entidade: 'os', entidade_id: os.id, acao: 'AVISO_CANCELAMENTO', ator: 'sistema',
    detalhe: { destinatarios: destinatarios.map((d) => d.nome), ids: lista.map((u) => u.id) },
  });
  return { enviado: true, destinatarios: destinatarios.length };
}
