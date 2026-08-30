// Predicados de papel — fonte única de verdade do RBAC, sem I/O e sem
// dependência de servidor.
//
// Existe porque as regras precisam ser conhecidas nos DOIS lados: o servidor
// decide de verdade (src/lib/auth.ts + rotas em src/app/api/*), e a interface
// precisa das mesmas regras pra não mostrar um botão que vai tomar 403 no
// submit. Como src/lib/auth.ts importa `crypto`/`bcryptjs`/`NextRequest`, ele
// não pode ser importado por um componente `'use client'` — antes disso, a
// regra acabava duplicada em auth.ts e permissions.ts, com o risco real de uma
// mudar e a outra não. Este arquivo é o denominador comum: nada aqui pode
// importar nada de servidor.
import type { UserRole } from './db';

// Administração de usuários e trilhas de auditoria.
export function isAdmin(role?: UserRole): boolean {
  return role === 'admin';
}

// Operação de campo: abre/edita OS, checklist, fotos, cadastra equipamento.
export function isAdminOrTecnico(role?: UserRole): boolean {
  return role === 'admin' || role === 'tecnico';
}

// Síndico é escopado ao próprio condomínio — quem chama precisa cruzar com o
// condominio_id do usuário (ver canAccessCondominio em src/lib/auth.ts).
export function isScopedToOwnCondominio(role?: UserRole): boolean {
  return role === 'sindico';
}
