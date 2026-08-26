import { NextRequest, NextResponse } from 'next/server';
import { Database } from '@/lib/db';
import { getSessionFromRequest, canAccessCondominio } from '@/lib/auth';

type RouteContext = { params: Promise<{ id: string; itemId: string }> };

// PATCH /api/os/[id]/checklist/[itemId] — marca item como concluído. Admin ou técnico.
export async function PATCH(request: NextRequest, context: RouteContext) {
  const { id, itemId } = await context.params;
  const session = getSessionFromRequest(request);
  if (!session || (session.role !== 'admin' && session.role !== 'tecnico')) {
    return NextResponse.json({ error: 'Acesso negado.' }, { status: 403 });
  }
  const os = await Database.getOSById(id);
  if (!os) return NextResponse.json({ error: 'OS não encontrada.' }, { status: 404 });
  if (!(await canAccessCondominio(session, os.condominio_id))) {
    return NextResponse.json({ error: 'Você não tem acesso a esta OS.' }, { status: 403 });
  }
  const item = await Database.concluirChecklistItem(itemId);
  if (!item) return NextResponse.json({ error: 'Item não encontrado.' }, { status: 404 });
  return NextResponse.json({ success: true, item });
}
