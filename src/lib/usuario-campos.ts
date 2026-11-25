// Validação dos campos operacionais do usuário (especialidade do técnico e
// chat do Telegram) — compartilhada entre POST /api/users e PATCH
// /api/users/[id]. `null`/'' = limpar; `undefined` no retorno = inválido.
import type { Especialidade, User, UserRole } from './db';
import { isPapelValido } from './roles';

export function normalizarEspecialidade(v: unknown): Especialidade | null | undefined {
  if (v === null || v === '' || v === 'ambas') return null;
  return v === 'corretiva' || v === 'preventiva' ? v : undefined;
}

// Chat id do Telegram é numérico (grupo começa com "-"). Aceita colado com
// espaço sem reclamar.
export function normalizarTelegramChatId(v: unknown): string | null | undefined {
  if (v === null || v === '') return null;
  if (typeof v !== 'string') return undefined;
  const limpo = v.replace(/\s/g, '');
  return /^-?\d{5,20}$/.test(limpo) ? limpo : undefined;
}

// Troca de perfil (papel) pelo "Editar" da Gestão de Usuários. Só o gestor
// chama (a rota já barra os outros). Devolve o erro para mostrar ou os campos
// a gravar junto com o papel novo, limpando o que não vale mais:
//  - virou síndico: precisa de condomínio; sai do plantão e da especialidade;
//  - deixou de ser síndico: perde o vínculo com o condomínio;
//  - deixou de ser técnico: sai do plantão e perde a especialidade.
// Ninguém troca o próprio perfil: assim o gestor não tira o próprio acesso
// por engano e sempre sobra pelo menos um gestor.
export type TrocaPapel =
  | { erro: string }
  | { campos: { papel: UserRole; condominio_id?: string | null; especialidade?: null; de_plantao?: false } };

export function avaliarTrocaPapel(args: {
  alvo: Pick<User, 'id' | 'papel'>;
  novoPapel: unknown;
  condominioId?: unknown;
  sessaoId: string;
  condominioExiste: boolean;
}): TrocaPapel {
  const { alvo, novoPapel, condominioId, sessaoId, condominioExiste } = args;
  if (!isPapelValido(novoPapel)) return { erro: 'Perfil inválido.' };
  if (novoPapel === alvo.papel) {
    // Mesmo papel: nada a trocar (o síndico pode só mudar de condomínio).
    if (novoPapel === 'sindico' && typeof condominioId === 'string' && condominioId) {
      if (!condominioExiste) return { erro: 'Condomínio não encontrado.' };
      return { campos: { papel: novoPapel, condominio_id: condominioId } };
    }
    return { campos: { papel: novoPapel } };
  }
  if (alvo.id === sessaoId) return { erro: 'Você não pode trocar o próprio perfil.' };
  const campos: { papel: UserRole; condominio_id?: string | null; especialidade?: null; de_plantao?: false } = {
    papel: novoPapel,
  };
  if (novoPapel === 'sindico') {
    if (typeof condominioId !== 'string' || !condominioId) return { erro: 'Selecione o condomínio do síndico.' };
    if (!condominioExiste) return { erro: 'Condomínio não encontrado.' };
    campos.condominio_id = condominioId;
  } else if (alvo.papel === 'sindico') {
    campos.condominio_id = null;
  }
  if (alvo.papel === 'tecnico') {
    campos.especialidade = null;
    campos.de_plantao = false;
  }
  return { campos };
}
