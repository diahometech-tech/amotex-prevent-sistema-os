import { NextRequest, NextResponse } from 'next/server';
import { Database } from '@/lib/db';
import { getSessionFromRequest, canManageUsers, hashPassword } from '@/lib/auth';

function safe(u: any) {
  const { password, ...rest } = u;
  return rest;
}

// PATCH /api/users/[id] — reseta senha e/ou ativa/desativa. Só gestor/admin.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = getSessionFromRequest(request);
  if (!session || !canManageUsers(session.role)) {
    return NextResponse.json({ error: 'Acesso negado.' }, { status: 403 });
  }
  const { id } = await params;
  try {
    const { password, active, terceiro_projeto, gestor_projetos } = await request.json();
    const updates: Record<string, unknown> = {};
    // Hash antes de gravar — mesma função usada em POST /api/users (Database.createUser).
    if (typeof password === 'string' && password.length > 0) updates.password = hashPassword(password);
    if (typeof active === 'boolean') updates.active = active;
    // Isolamento por projeto (só faz sentido pro papel 'terceiro'; não checamos
    // o papel aqui pois é inofensivo gravar num usuário de outro papel — o
    // campo só é lido nas rotas do terceiro). String vazia limpa a restrição.
    if (typeof terceiro_projeto === 'string') updates.terceiro_projeto = terceiro_projeto.trim();
    // Isolamento por projeto(s) pro papel 'gestor' — mesma lógica, lista
    // separada por vírgula (ver src/lib/gestor-scope.ts). String vazia limpa
    // a restrição (conta volta a ver tudo).
    if (typeof gestor_projetos === 'string') updates.gestor_projetos = gestor_projetos.trim();
    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'Nada para atualizar.' }, { status: 400 });
    }
    const user = await Database.updateUser(id, updates);
    if (!user) return NextResponse.json({ error: 'Usuário não encontrado.' }, { status: 404 });
    return NextResponse.json({ success: true, user: safe(user) });
  } catch (e) {
    console.error('Erro ao atualizar usuário:', e);
    return NextResponse.json({ error: 'Erro interno.' }, { status: 500 });
  }
}

// DELETE /api/users/[id] — exclui o acesso permanentemente. Só gestor/admin.
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = getSessionFromRequest(request);
  if (!session || !canManageUsers(session.role)) {
    return NextResponse.json({ error: 'Acesso negado.' }, { status: 403 });
  }
  const { id } = await params;
  if (id === session.id) {
    return NextResponse.json({ error: 'Você não pode excluir o próprio acesso.' }, { status: 400 });
  }
  const removed = await Database.deleteUser(id);
  if (!removed) return NextResponse.json({ error: 'Usuário não encontrado.' }, { status: 404 });
  return NextResponse.json({ success: true });
}
