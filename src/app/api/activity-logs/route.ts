import { NextRequest, NextResponse } from 'next/server';
import { Database } from '@/lib/db';
import { getSessionFromRequest } from '@/lib/auth';
import { getGestorScope, dossierInGestorScope } from '@/lib/gestor-scope';

// GET /api/activity-logs
// Trilha de auditoria COMPLETA (todas as OS, não só uma) — base do "Log de
// Acessos" pra responder "tudo que o Fulano fez", sem abrir OS por OS. Só
// gestor/admin.
export async function GET(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session || (session.role !== 'gestor' && session.role !== 'admin')) {
    return NextResponse.json({ error: 'Acesso restrito a gestor/admin.' }, { status: 403 });
  }
  let logs = await Database.getLogs();
  // Isolamento entre gestores de projetos diferentes (ver src/lib/gestor-scope.ts)
  // — sem isso, uma conta gestor escopada veria nome de cliente/detalhes de
  // OS de outros gestores/projetos aqui, mesmo sem acesso direto à OS.
  if (session.role === 'gestor') {
    const escopo = await getGestorScope(session);
    if (escopo.length > 0) {
      const [ativos, excluidos] = await Promise.all([Database.getDossiers(), Database.getDeletedDossiers()]);
      const idsNoEscopo = new Set(
        [...ativos, ...excluidos].filter((d) => dossierInGestorScope(d, escopo)).map((d) => d.id)
      );
      logs = logs.filter((l) => !l.dossier_id || idsNoEscopo.has(l.dossier_id));
    }
  }
  return NextResponse.json({ logs });
}
