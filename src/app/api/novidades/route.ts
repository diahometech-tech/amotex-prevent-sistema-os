import { NextRequest, NextResponse } from 'next/server';
import { Database } from '@/lib/db';
import { getSessionFromRequest } from '@/lib/auth';
import { novidadesPara } from '@/lib/novidades';

// GET /api/novidades — novidades do perfil da sessão, mais recentes primeiro,
// cada uma com `lida` para o usuário logado.
export async function GET(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
  try {
    const lidas = new Set(await Database.getNovidadesLidas(session.id));
    const novidades = novidadesPara(session.role).map((n) => ({ ...n, lida: lidas.has(n.id) }));
    return NextResponse.json({ novidades }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    console.error('Erro ao listar novidades:', e);
    return NextResponse.json({ error: 'Erro interno.' }, { status: 500 });
  }
}
