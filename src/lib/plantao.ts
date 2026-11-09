// Quem é avisado de corretiva — regra da Amotex (09/11): os técnicos
// trabalham em plantões intercalados e o supervisor define a ordem. O aviso
// vai pros gestores (admin, sempre) e pro(s) técnico(s) DE PLANTÃO. Se
// ninguém estiver marcado de plantão, vai pra todos os técnicos que atendem
// corretiva — melhor acordar todo mundo do que ninguém.
//
// Puro (sem I/O): usado pelo servidor (notificacao-corretiva.ts, resumo
// diário) e pela tela de Usuários/painel.
import type { User } from './db';

export function atendeCorretiva(u: Pick<User, 'papel' | 'especialidade' | 'ativo'>): boolean {
  return u.ativo && u.papel === 'tecnico' && u.especialidade !== 'preventiva';
}

export function plantonistas<T extends Pick<User, 'papel' | 'especialidade' | 'ativo' | 'de_plantao'>>(users: T[]): T[] {
  return users.filter((u) => atendeCorretiva(u) && u.de_plantao);
}

export interface EscolhaAviso<T> {
  /** Quem recebe (só quem tem Telegram). */
  destinatarios: T[];
  /** Nomes de quem está de plantão; vazio = ninguém marcado (aviso a todos). */
  plantao: string[];
  /** Plantonistas sem Telegram — o aviso não chega neles; a tela alerta. */
  plantaoSemTelegram: string[];
}

export function escolherDestinatarios<
  T extends Pick<User, 'nome' | 'papel' | 'especialidade' | 'ativo' | 'de_plantao' | 'telegram_chat_id'>,
>(users: T[]): EscolhaAviso<T> {
  const dePlantao = plantonistas(users);
  const tecnicos = dePlantao.length > 0 ? dePlantao : users.filter(atendeCorretiva);
  const gestores = users.filter((u) => u.ativo && u.papel === 'admin');
  return {
    destinatarios: [...gestores, ...tecnicos].filter((u) => u.telegram_chat_id),
    plantao: dePlantao.map((u) => u.nome),
    plantaoSemTelegram: dePlantao.filter((u) => !u.telegram_chat_id).map((u) => u.nome),
  };
}
