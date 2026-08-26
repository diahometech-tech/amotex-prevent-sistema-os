import { NextRequest, NextResponse } from 'next/server';
import { Database } from '@/lib/db';
import { getSessionFromRequest } from '@/lib/auth';

// GET /api/auth/me — retorna o usuário logado (ou 401).
export async function GET(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
  }
  // Revalida contra o banco (papel/ativo podem ter mudado).
  const user = await Database.getUserById(session.id);
  if (!user || !user.ativo) {
    return NextResponse.json({ error: 'Sessão inválida.' }, { status: 401 });
  }
  return NextResponse.json({ user: { id: user.id, name: user.nome, role: user.papel, condominio_id: user.condominio_id } });
}
