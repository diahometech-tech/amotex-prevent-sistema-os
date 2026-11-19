import { NextRequest, NextResponse } from 'next/server';
import { Database } from '@/lib/db';
import { getSessionFromRequest, podeVerOS } from '@/lib/auth';
import { podeOperarCampo } from '@/lib/roles';

type RouteContext = { params: Promise<{ id: string; itemId: string }> };

// PATCH /api/os/[id]/checklist/[itemId] — marca item como concluído. Gestor ou técnico (campo), só nas OS que vê.
export async function PATCH(request: NextRequest, context: RouteContext) {
  const { id, itemId } = await context.params;
  const session = getSessionFromRequest(request);
  if (!session || !podeOperarCampo(session.role)) {
    return NextResponse.json({ error: 'Acesso negado.' }, { status: 403 });
  }
  const os = await Database.getOSById(id);
  if (!os) return NextResponse.json({ error: 'OS não encontrada.' }, { status: 404 });
  if (!(await podeVerOS(session, os))) {
    return NextResponse.json({ error: 'Sem acesso a esta OS.' }, { status: 403 });
  }
  // O item tem que ser desta OS (antes bastava saber o id de qualquer item).
  const doChecklist = await Database.getChecklistByOS(id);
  if (!doChecklist.some((i) => i.id === itemId)) {
    return NextResponse.json({ error: 'Item não encontrado.' }, { status: 404 });
  }
  const item = await Database.concluirChecklistItem(itemId);
  if (!item) return NextResponse.json({ error: 'Item não encontrado.' }, { status: 404 });
  return NextResponse.json({ success: true, item });
}
