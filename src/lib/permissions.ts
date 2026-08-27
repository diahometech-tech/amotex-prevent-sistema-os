// RBAC da interface — só decide o que MOSTRAR/HABILITAR na tela.
// A garantia real de acesso é sempre server-side (ver src/lib/auth.ts,
// canManageUsers/isScopedToOwnCondominio, e os endpoints em src/app/api/*).
// Este arquivo nunca deve ser a única barreira de um dado sensível.
import type { UserRole } from './db';

export interface SessionUserLike {
  role: UserRole;
}

// Admin e técnico cadastram/editam condomínio, reservatório, contato e
// equipamento. Síndico só enxerga o próprio condomínio (Painel Condominial),
// sem poder de edição — ver isScopedToOwnCondominio em src/lib/auth.ts.
export function canEditCadastro(role: UserRole): boolean {
  return role === 'admin' || role === 'tecnico';
}

// Quem pode abrir/editar uma OS, marcar itens de checklist e enviar fotos.
export function canManageOS(role: UserRole): boolean {
  return role === 'admin' || role === 'tecnico';
}

// Só quem executa o serviço finaliza a OS — trava de qualidade adicional:
// mesmo um admin/tecnico só finaliza se o checklist obrigatório estiver
// completo (ver checklistBloqueiaFinalizacao, espelha Database.finalizarOS
// em src/lib/db.ts).
export function canFinalizeOS(role: UserRole): boolean {
  return role === 'admin' || role === 'tecnico';
}

// Síndico e demais papéis sem canManageOS só têm leitura: histórico,
// checklist, fotos e assinaturas já registradas.
export function canManageUsersNav(role: UserRole): boolean {
  return role === 'admin';
}

export const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Administrador',
  tecnico: 'Técnico',
  sindico: 'Síndico',
};
