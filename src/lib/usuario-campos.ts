// Validação dos campos operacionais do usuário (especialidade do técnico e
// chat do Telegram) — compartilhada entre POST /api/users e PATCH
// /api/users/[id]. `null`/'' = limpar; `undefined` no retorno = inválido.
import type { Especialidade } from './db';

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
