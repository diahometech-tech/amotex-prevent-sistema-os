import { NextRequest, NextResponse } from 'next/server';
import { Database } from '@/lib/db';
import { getSessionFromRequest, podeVerOS } from '@/lib/auth';
import { podeOperarCampo, osEncerrada } from '@/lib/roles';

type RouteContext = { params: Promise<{ id: string; itemId: string }> };

// PATCH /api/os/[id]/checklist/[itemId] — marca ou desmarca o item. Corpo { concluido: boolean };
// sem corpo = marcar (compatível com a fila e chamadas antigas). Gestor ou técnico (campo), só nas OS que vê.
// Marcar e desmarcar só enquanto a OS não está finalizada/cancelada e, para o técnico, só na OS dele.
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
  let concluido = true;
  try {
    const corpo = await request.json();
    if (corpo && typeof corpo.concluido === 'boolean') concluido = corpo.concluido;
  } catch {
    // sem corpo (ou corpo inválido) = marcar, como sempre foi
  }
  // Mesma regra nos dois sentidos: OS encerrada não muda, e o técnico só mexe na OS dele.
  if (osEncerrada(os)) return NextResponse.json({ error: 'OS encerrada.' }, { status: 409 });
  if (session.role === 'tecnico' && os.tecnico_id !== session.id) {
    return NextResponse.json({ error: 'Assuma a OS antes de mexer no checklist.' }, { status: 403 });
  }
  const atual = doChecklist.find((i) => i.id === itemId);
  const item = concluido
    ? await Database.concluirChecklistItem(itemId)
    : await Database.setChecklistItemConcluido(itemId, false);
  if (!item) return NextResponse.json({ error: 'Item não encontrado.' }, { status: 404 });
  if (!concluido && atual?.concluido) {
    await Database.createAuditLog({
      entidade: 'os',
      entidade_id: id,
      acao: 'CHECKLIST_DESMARCADO',
      ator: session.name,
      detalhe: { item_id: itemId, descricao: item.descricao },
    });
  }
  return NextResponse.json({ success: true, item });
}
