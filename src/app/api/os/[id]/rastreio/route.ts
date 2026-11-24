import { NextRequest, NextResponse } from 'next/server';
import { Database } from '@/lib/db';
import { getSessionFromRequest } from '@/lib/auth';
import { podeLerRastreio } from '@/lib/rastreio';
import { montarRastreio } from '@/lib/rastreio-servidor';

type RouteContext = { params: Promise<{ id: string }> };

// GET /api/os/[id]/rastreio — onde o técnico está e quando chega.
// Gestor e secretária: qualquer OS. Síndico: só do próprio condomínio (cruzado
// com o banco). Técnico: só a OS dele. Fora da janela ativa não devolve posição
// (a localização some na chegada). Só a última posição, nunca o trajeto.
export async function GET(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const session = getSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: 'Sessão expirada.' }, { status: 401 });
  const os = await Database.getOSById(id);
  if (!os) return NextResponse.json({ error: 'OS não encontrada.' }, { status: 404 });

  const condominioDoUsuario = session.role === 'sindico' ? (await Database.getUserById(session.id))?.condominio_id ?? null : null;
  if (!podeLerRastreio(session, os, condominioDoUsuario)) {
    return NextResponse.json({ error: 'Sem acesso a esta OS.' }, { status: 403 });
  }

  const [condominio, tecnico, [ultima]] = await Promise.all([
    Database.getCondominioById(os.condominio_id),
    os.tecnico_id ? Database.getUserById(os.tecnico_id) : Promise.resolve(null),
    Database.getUltimasPosicoes([id]),
  ]);
  return NextResponse.json(montarRastreio(os, condominio, tecnico, ultima ?? null), {
    headers: { 'Cache-Control': 'no-store' },
  });
}
