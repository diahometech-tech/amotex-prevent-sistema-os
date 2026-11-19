// RBAC da interface — só decide o que MOSTRAR na tela. Regra de visibilidade:
// cada papel só vê o que é dele (esconder, não desabilitar). A garantia real
// de acesso é sempre server-side (src/lib/auth.ts e src/app/api/*); este
// arquivo nunca deve ser a única barreira de um dado sensível.
//
// Todas as regras moram em src/lib/roles.ts, o mesmo módulo que o servidor usa
// — assim UI e API não divergem (UI liberando mais que a API faz o usuário
// preencher um formulário inteiro e tomar 403 no fim). Telas importam os
// predicados direto de '@/lib/roles'; aqui ficam só rótulos e atalhos de
// administração.
import type { UserRole } from './db';
import { isAdmin } from './roles';

// Administração de usuários (e trilhas de auditoria) — só o gestor.
export function canManageUsers(role: UserRole): boolean {
  return isAdmin(role);
}

// "Administrador" virou "Gestor" no vocabulário da equipe (a secretária é a
// novidade; o rótulo antigo confundia quem não é de TI).
export const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Gestor',
  secretaria: 'Secretária',
  tecnico: 'Técnico',
  sindico: 'Síndico',
};
