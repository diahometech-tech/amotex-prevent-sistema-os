import { NextRequest, NextResponse } from 'next/server';
import { Database } from '@/lib/db';
import { SESSION_COOKIE, encodeSession, getSessionFromRequest } from '@/lib/auth';

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
  const res = NextResponse.json({ user: { id: user.id, name: user.nome, role: user.papel, condominio_id: user.condominio_id } });
  // O gestor trocou o perfil desta pessoa (Gestão de Usuários > Editar): o
  // cookie ainda traz o papel antigo e as rotas confiam nele. Regrava o cookie
  // com o papel do banco, para a troca valer já na próxima tela que ela abrir,
  // sem precisar sair e entrar de novo.
  if (session.role !== user.papel || session.name !== user.nome) {
    res.cookies.set(SESSION_COOKIE, encodeSession({ id: user.id, name: user.nome, role: user.papel }), {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 12, // 12h, igual ao login
    });
  }
  return res;
}
