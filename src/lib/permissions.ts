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
//
// Os predicados vêm de src/lib/roles.ts, o mesmo módulo que src/lib/auth.ts
// usa no servidor — antes as regras estavam escritas duas vezes (uma aqui,
// outra em auth.ts) e podiam divergir sem ninguém notar. Não dá pra importar
// auth.ts direto aqui: ele puxa bcrypt/crypto, que não podem ir pro bundle
// do cliente.
import type { UserRole } from './db';
import { isAdmin, isAdminOrTecnico } from './roles';

// POST/PATCH /api/condominios[/id] — admin apenas.
export function canEditCondominio(role: UserRole): boolean {
  return isAdmin(role);
}

// POST /api/condominios/[id]/reservatorios e PATCH /api/reservatorios/[id] —
// admin apenas.
export function canEditReservatorio(role: UserRole): boolean {
  return isAdmin(role);
}

// POST /api/condominios/[id]/contatos e PATCH /api/contatos/[id] — admin apenas.
export function canEditContato(role: UserRole): boolean {
  return isAdmin(role);
}

// POST /api/condominios/[id]/equipamentos — admin OU técnico (o cadastro de
// equipamento acontece na primeira visita técnica, em campo).
export function canEditEquipamento(role: UserRole): boolean {
  return isAdminOrTecnico(role);
}

// POST /api/os, PATCH /api/os/[id], checklist e fotos — admin ou técnico.
export function canManageOS(role: UserRole): boolean {
  return isAdminOrTecnico(role);
}

// Finalizar é o mesmo PATCH /api/os/[id] (com finalizar: true) — mesmo papel.
// A trava de qualidade (checklist obrigatório pendente) é adicional e vale
// pra todo mundo, inclusive admin: ver Database.finalizarOS em src/lib/db.ts.
export function canFinalizeOS(role: UserRole): boolean {
  return isAdminOrTecnico(role);
}

// GET/POST /api/users e /api/activity-logs, /api/session-logs — admin apenas
// (canManageUsers em src/lib/auth.ts). Nota: o GET de /api/users também
// responde a técnico, mas com payload reduzido (só id/nome dos técnicos, pra
// preencher o seletor de responsável) — isso não é "gerenciar usuários".
export function canManageUsers(role: UserRole): boolean {
  return isAdmin(role);
}

export const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Administrador',
  tecnico: 'Técnico',
  sindico: 'Síndico',
};
