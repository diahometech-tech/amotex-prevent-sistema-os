import { NextRequest, NextResponse } from 'next/server';
import { Database } from '@/lib/db';
import { getSessionFromRequest, getClientIp } from '@/lib/auth';
import { getGestorScope, dossierInGestorScope } from '@/lib/gestor-scope';

type RouteContext = { params: Promise<{ id: string }> };

// POST /api/dossiers/[id]/restore — restaura um dossiê excluído. Restrito a gestor/admin.
export async function POST(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const session = getSessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ error: 'Sessão expirada.' }, { status: 401 });
  }
  if (session.role !== 'gestor' && session.role !== 'admin') {
    return NextResponse.json({ error: 'Apenas gestor ou admin podem restaurar cadastros.' }, { status: 403 });
  }
  try {
    if (session.role === 'gestor') {
      const escopo = await getGestorScope(session);
      if (escopo.length > 0) {
        const deleted = await Database.getDeletedDossiers();
        const alvo = deleted.find((d) => d.id === id);
        if (alvo && !dossierInGestorScope(alvo, escopo)) {
          return NextResponse.json({ error: 'Esta OS não pertence a um projeto do seu acesso.' }, { status: 403 });
        }
      }
    }
    const ok = await Database.restoreDossier(id);
    if (!ok) {
      return NextResponse.json({ error: 'Cadastro não encontrado na Lixeira.' }, { status: 404 });
    }
    await Database.createLog({
      ip_address: getClientIp(request),
      dossier_id: id,
      user_name: session.name,
      action_type: 'DOSSIE_RESTAURADO',
      details: `Restaurou o cadastro da Lixeira.`,
    });
    return NextResponse.json({ success: true });
  } catch (e) {
    console.error('Erro ao restaurar dossiê:', e);
    return NextResponse.json({ error: 'Erro interno.' }, { status: 500 });
  }
}
