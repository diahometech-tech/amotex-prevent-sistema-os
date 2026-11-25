import { NextRequest, NextResponse } from 'next/server';
import { Database } from '@/lib/db';
import { getSessionFromRequest } from '@/lib/auth';
import { novidadePara } from '@/lib/novidades';

// POST /api/novidades/[id]/lida — marca a novidade como lida para o usuário da
// sessão. 404 se o id não existir ou não for do perfil dele.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = getSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
  const { id } = await params;
  if (!novidadePara(session.role, id)) {
    return NextResponse.json({ error: 'Novidade não encontrada.' }, { status: 404 });
  }
  try {
    await Database.marcarNovidadeLida(session.id, id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('Erro ao marcar novidade como lida:', e);
    return NextResponse.json({ error: 'Erro interno.' }, { status: 500 });
  }
}
