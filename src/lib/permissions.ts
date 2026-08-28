// RBAC da interface — só decide o que MOSTRAR/HABILITAR na tela.
// A garantia real de acesso é sempre server-side (ver src/lib/auth.ts,
// canManageUsers/isScopedToOwnCondominio/canAccessCondominio, e os endpoints
// em src/app/api/*). Este arquivo nunca deve ser a única barreira de um dado
// sensível.
//
// IMPORTANTE: cada helper aqui espelha o guard da rota correspondente. Se a
// UI liberar mais que a API, o usuário preenche um formulário inteiro e toma
// 403 no fim — foi exatamente o bug que existia aqui (um único
// `canEditCadastro` = admin+técnico cobrindo rotas que são admin-only).
// Ao mexer, confira o `if (!session || ...)` da rota antes.
import type { UserRole } from './db';

// POST/PATCH /api/condominios[/id] — admin apenas.
export function canEditCondominio(role: UserRole): boolean {
  return role === 'admin';
}

// POST /api/condominios/[id]/reservatorios — admin apenas.
export function canEditReservatorio(role: UserRole): boolean {
  return role === 'admin';
}

// POST /api/condominios/[id]/contatos — admin apenas.
export function canEditContato(role: UserRole): boolean {
  return role === 'admin';
}

// POST /api/condominios/[id]/equipamentos — admin OU técnico (o cadastro de
// equipamento acontece na primeira visita técnica, em campo).
export function canEditEquipamento(role: UserRole): boolean {
  return role === 'admin' || role === 'tecnico';
}

// POST /api/os, PATCH /api/os/[id], checklist e fotos — admin ou técnico.
export function canManageOS(role: UserRole): boolean {
  return role === 'admin' || role === 'tecnico';
}

// Finalizar é o mesmo PATCH /api/os/[id] (com finalizar: true) — mesmo papel.
// A trava de qualidade (checklist obrigatório pendente) é adicional e vale
// pra todo mundo, inclusive admin: ver Database.finalizarOS em src/lib/db.ts.
export function canFinalizeOS(role: UserRole): boolean {
  return role === 'admin' || role === 'tecnico';
}

// GET/POST /api/users e /api/activity-logs, /api/session-logs — admin apenas
// (canManageUsers em src/lib/auth.ts).
export function canManageUsers(role: UserRole): boolean {
  return role === 'admin';
}

export const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Administrador',
  tecnico: 'Técnico',
  sindico: 'Síndico',
};
