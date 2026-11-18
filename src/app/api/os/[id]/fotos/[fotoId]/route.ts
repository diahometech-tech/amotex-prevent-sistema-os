import { NextRequest, NextResponse } from 'next/server';
import { Database } from '@/lib/db';
import { getSessionFromRequest, canAccessCondominio } from '@/lib/auth';

type RouteContext = { params: Promise<{ id: string; fotoId: string }> };

// DELETE /api/os/[id]/fotos/[fotoId] — tira uma foto errada (foto tremida,
// do equipamento errado). Admin ou técnico, e só com a OS em aberto: depois
// de finalizada a foto já está no PDF que o síndico recebeu.
export async function DELETE(request: NextRequest, context: RouteContext) {
  const { id, fotoId } = await context.params;
  const session = getSessionFromRequest(request);
  if (!session || (session.role !== 'admin' && session.role !== 'tecnico')) {
    return NextResponse.json({ error: 'Acesso negado.' }, { status: 403 });
  }
  const os = await Database.getOSById(id);
  if (!os) return NextResponse.json({ error: 'OS não encontrada.' }, { status: 404 });
  if (!(await canAccessCondominio(session, os.condominio_id))) {
    return NextResponse.json({ error: 'Você não tem acesso a esta OS.' }, { status: 403 });
  }
  if (os.status === 'finalizada' || os.status === 'cancelada') {
    return NextResponse.json({ error: 'A OS já foi encerrada; as fotos não podem mais ser removidas.' }, { status: 409 });
  }
  const foto = (await Database.getFotosByOS(id)).find((f) => f.id === fotoId);
  if (!foto) return NextResponse.json({ error: 'Foto não encontrada.' }, { status: 404 });
  try {
    await Database.apagarFoto(foto, session.name);
    return NextResponse.json({ success: true });
  } catch (e) {
    console.error('Erro ao remover foto:', e);
    return NextResponse.json({ error: 'Não foi possível remover a foto.' }, { status: 500 });
  }
}
