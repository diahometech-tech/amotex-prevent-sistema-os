import { NextRequest, NextResponse } from 'next/server';
import { Database } from '@/lib/db';
import { getSessionFromRequest, podeVerOS } from '@/lib/auth';
import { podeOperarCampo, osEncerrada } from '@/lib/roles';

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
  if (osEncerrada(os)) return NextResponse.json({ error: 'OS encerrada.' }, { status: 409 });
  // Mesmo critério do cadastro de equipamento: técnico só mexe na OS que já é dele.
  if (session.role === 'tecnico' && os.tecnico_id !== session.id) {
    return NextResponse.json({ error: 'Assuma a OS antes de mexer no checklist.' }, { status: 403 });
  }
  try {
    const { descricao, equipamento_id, obrigatorio } = await request.json();
    if (!descricao) return NextResponse.json({ error: 'Descreva o item do checklist.' }, { status: 400 });
    // Item ligado a equipamento vira exigência de foto: o equipamento tem de ser deste condomínio.
    if (equipamento_id !== undefined && equipamento_id !== null && equipamento_id !== '') {
      const eq = typeof equipamento_id === 'string' ? await Database.getEquipamentoById(equipamento_id) : null;
      if (!eq || eq.condominio_id !== os.condominio_id) {
        return NextResponse.json({ error: 'Equipamento não encontrado neste condomínio.' }, { status: 400 });
      }
    }
    const item = await Database.createChecklistItem({ os_id: id, descricao, equipamento_id, obrigatorio });
    return NextResponse.json({ success: true, item });
  } catch (e) {
    console.error('Erro ao criar item de checklist:', e);
    return NextResponse.json({ error: 'Erro interno.' }, { status: 500 });
  }
}
