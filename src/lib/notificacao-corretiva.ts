// Aviso operacional de corretiva (regra da Amotex, 23/10): toda corretiva é
// urgente, com 3h pra chegada — técnicos de corretiva e gestores são
// avisados na ABERTURA, e de novo quando alguém ASSUME (pra dois técnicos
// não irem ao mesmo chamado).
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

export interface Destinatario {
  nome: string;
  papel: User['papel'];
  telegram_chat_id: string;
}

export type { ResultadoAviso };

// Gestores (admin) + técnicos de corretiva (ou sem especialidade = as duas),
// ativos e com Telegram cadastrado.
export async function destinatariosCorretiva(): Promise<Destinatario[]> {
  const users = await Database.getUsers();
  return users
    .filter((u) => u.ativo && u.telegram_chat_id)
    .filter((u) => u.papel === 'admin' || (u.papel === 'tecnico' && u.especialidade !== 'preventiva'))
    .map((u) => ({ nome: u.nome, papel: u.papel, telegram_chat_id: u.telegram_chat_id! }));
}

function linkOs(osId: string): string | undefined {
  const base = process.env.APP_URL?.replace(/\/$/, '');
  return base ? `${base}/?os=${osId}` : undefined;
}

export function mensagemCorretivaAberta(os: OS, condominio: Condominio, tecnico?: User | null): string {
  const sla = slaChegada(os);
  const linhas = [
    `🚨 CORRETIVA URGENTE — ${condominio.nome}`,
    condominio.endereco,
    os.descricao_problema && `Problema: ${os.descricao_problema}`,
    (os.solicitante_nome || os.solicitante_telefone) &&
      `Solicitante: ${[os.solicitante_nome, os.solicitante_telefone].filter(Boolean).join(' · ')}`,
    `Técnico: ${tecnico?.nome ?? 'ninguém ainda — quem for, assuma a OS no sistema'}`,
    sla && `⏱ Chegar até ${fmtHora(sla.prazo)} (prazo de 3h)`,
    linkOs(os.id),
  ];
  return escaparMarkdown(linhas.filter(Boolean).join('\n'));
}

export function mensagemCorretivaAssumida(os: OS, condominio: Condominio, tecnico: User): string {
  const sla = slaChegada(os);
  return escaparMarkdown([
    `✅ ${tecnico.nome} assumiu a corretiva — ${condominio.nome}`,
    sla && `⏱ Chegar até ${fmtHora(sla.prazo)}`,
    linkOs(os.id),
  ]
    .filter(Boolean)
    .join('\n'));
}

export async function avisarCorretiva(
  evento: 'os_corretiva_aberta' | 'os_corretiva_assumida',
  os: OS
): Promise<ResultadoAviso> {
  if (os.tipo !== 'corretiva') return { enviado: false, destinatarios: 0, motivo: 'não é corretiva' };
  const [condominio, tecnico, destinatarios] = await Promise.all([
    Database.getCondominioById(os.condominio_id),
    os.tecnico_id ? Database.getUserById(os.tecnico_id) : Promise.resolve(null),
    destinatariosCorretiva(),
  ]);
  if (!condominio) return { enviado: false, destinatarios: 0, motivo: 'condomínio não encontrado' };
  if (!webhookConfigurado()) {
    return { enviado: false, destinatarios: destinatarios.length, motivo: 'aviso por Telegram ainda não configurado no servidor' };
  }
  if (destinatarios.length === 0) {
    return { enviado: false, destinatarios: 0, motivo: 'ninguém com Telegram cadastrado em Usuários' };
  }
  if (evento === 'os_corretiva_assumida' && !tecnico) {
    return { enviado: false, destinatarios: 0, motivo: 'OS sem técnico' };
  }

  const mensagem =
    evento === 'os_corretiva_aberta'
      ? mensagemCorretivaAberta(os, condominio, tecnico)
      : mensagemCorretivaAssumida(os, condominio, tecnico!);
  const sla = slaChegada(os);
  notifyN8n(evento, os, {
    mensagem,
    destinatarios,
    condominio: { nome: condominio.nome, endereco: condominio.endereco },
    tecnico_nome: tecnico?.nome,
    prazo_chegada: sla ? new Date(sla.prazo).toISOString() : undefined,
    link: linkOs(os.id),
  });
  await Database.createAuditLog({
    entidade: 'os', entidade_id: os.id, acao: evento === 'os_corretiva_aberta' ? 'AVISO_ABERTURA' : 'AVISO_ASSUMIDA',
    ator: 'sistema', detalhe: { destinatarios: destinatarios.map((d) => d.nome) },
  });
  return { enviado: true, destinatarios: destinatarios.length };
}
