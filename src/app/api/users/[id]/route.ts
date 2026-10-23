import { NextRequest, NextResponse } from 'next/server';
import { Database, type User } from '@/lib/db';
import { getSessionFromRequest, canManageUsers, hashPassword } from '@/lib/auth';
import { normalizarEspecialidade, normalizarTelegramChatId } from '@/lib/usuario-campos';

function safe(u: User) {
  const { senha_hash: _senha_hash, ...rest } = u;
  return rest;
}

// PATCH /api/users/[id] — reseta senha, ativa/desativa, especialidade do
// técnico e chat do Telegram. Só admin.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = getSessionFromRequest(request);
  if (!session || !canManageUsers(session.role)) {
    return NextResponse.json({ error: 'Acesso negado.' }, { status: 403 });
  }
  const { id } = await params;
  try {
    const body = await request.json();
    const { senha, ativo, condominio_id } = body;
    const updates: Record<string, unknown> = {};
    if (typeof senha === 'string' && senha.length > 0) updates.senha_hash = hashPassword(senha);
    if (typeof ativo === 'boolean') updates.ativo = ativo;
    if (typeof condominio_id === 'string') updates.condominio_id = condominio_id;
    if (body.especialidade !== undefined) {
      const especialidade = normalizarEspecialidade(body.especialidade);
      if (especialidade === undefined) return NextResponse.json({ error: 'Especialidade inválida.' }, { status: 400 });
      updates.especialidade = especialidade;
    }
    if (body.telegram_chat_id !== undefined) {
      const chat = normalizarTelegramChatId(body.telegram_chat_id);
      if (chat === undefined) return NextResponse.json({ error: 'ID do Telegram inválido (só números).' }, { status: 400 });
      updates.telegram_chat_id = chat;
    }
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

// DELETE /api/users/[id] — exclui o acesso permanentemente. Só admin.
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
