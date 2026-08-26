import { NextRequest, NextResponse } from 'next/server';
import { Database } from '@/lib/db';
import { getSessionFromRequest, isFieldRole } from '@/lib/auth';

// GET /api/users/directory
// Diretório MÍNIMO (nome, papel, ativo) — usado pra popular "Enviar tarefa
// para..." e afins. Diferente de /api/users (que expõe username e é
// restrito a gestor/admin), este é liberado pra qualquer papel interno,
// porque atribuir/cobrar tarefa entre colegas não é privilégio de gestão.
export async function GET(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session || isFieldRole(session.role)) {
    return NextResponse.json({ error: 'Acesso negado.' }, { status: 403 });
  }
  const users = await Database.getUsers();
  return NextResponse.json({
    users: users.map((u) => ({ name: u.name, role: u.role, active: u.active })),
  });
}
