import { NextRequest, NextResponse } from 'next/server';
import { Database } from '@/lib/db';
import { getSessionFromRequest, canAccessCondominio } from '@/lib/auth';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const session = getSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: 'Sessão expirada.' }, { status: 401 });
  if (!(await canAccessCondominio(session, id))) {
    return NextResponse.json({ error: 'Você não tem acesso a este condomínio.' }, { status: 403 });
  }
  const equipamentos = await Database.getEquipamentosByCondominio(id);
  return NextResponse.json({ equipamentos });
}

// POST — cadastra equipamento (feito na primeira visita técnica). Admin ou técnico.
export async function POST(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const session = getSessionFromRequest(request);
  if (!session || (session.role !== 'admin' && session.role !== 'tecnico')) {
    return NextResponse.json({ error: 'Acesso negado.' }, { status: 403 });
  }
  try {
    const { tipo, modelo, potencia_hp } = await request.json();
    if (!tipo) return NextResponse.json({ error: 'Informe o tipo do equipamento.' }, { status: 400 });
    const equipamento = await Database.createEquipamento({ condominio_id: id, tipo, modelo, potencia_hp });
    return NextResponse.json({ success: true, equipamento });
  } catch (e) {
    console.error('Erro ao criar equipamento:', e);
    return NextResponse.json({ error: 'Erro interno.' }, { status: 500 });
  }
}
