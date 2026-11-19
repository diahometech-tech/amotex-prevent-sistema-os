import { NextRequest, NextResponse } from 'next/server';
import { Database } from '@/lib/db';
import { getSessionFromRequest, podeVerOS } from '@/lib/auth';
import { podeOperarCampo } from '@/lib/roles';

type RouteContext = { params: Promise<{ id: string }> };

// POST /api/os/[id]/checklist — adiciona item ao checklist (o técnico pode
// incluir verificação extra pedida na hora pelo síndico — roteiro guiado,
// mas flexível). Gestor ou técnico (campo), só nas OS que vê.
export async function POST(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const session = getSessionFromRequest(request);
  if (!session || !podeOperarCampo(session.role)) {
    return NextResponse.json({ error: 'Acesso negado.' }, { status: 403 });
  }
  const os = await Database.getOSById(id);
  if (!os) return NextResponse.json({ error: 'OS não encontrada.' }, { status: 404 });
  if (!(await podeVerOS(session, os))) {
    return NextResponse.json({ error: 'Sem acesso a esta OS.' }, { status: 403 });
  }
  try {
    const { descricao, equipamento_id, obrigatorio } = await request.json();
    if (!descricao) return NextResponse.json({ error: 'Descreva o item do checklist.' }, { status: 400 });
    const item = await Database.createChecklistItem({ os_id: id, descricao, equipamento_id, obrigatorio });
    return NextResponse.json({ success: true, item });
  } catch (e) {
    console.error('Erro ao criar item de checklist:', e);
    return NextResponse.json({ error: 'Erro interno.' }, { status: 500 });
  }
}
