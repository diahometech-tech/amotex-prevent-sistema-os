import { NextRequest, NextResponse } from 'next/server';
import { Database } from '@/lib/db';
import { getSessionFromRequest } from '@/lib/auth';
import { getGestorScope, dossierInGestorScope } from '@/lib/gestor-scope';

// GET /api/dossiers/deleted — lista dossiês excluídos (Lixeira). Restrito a gestor/admin.
export async function GET(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ error: 'Sessão expirada.' }, { status: 401 });
  }
  if (session.role !== 'gestor' && session.role !== 'admin') {
    return NextResponse.json({ error: 'Acesso restrito.' }, { status: 403 });
  }
  try {
    let dossiers = await Database.getDeletedDossiers();
    if (session.role === 'gestor') {
      const escopo = await getGestorScope(session);
      if (escopo.length > 0) {
        dossiers = dossiers.filter((d) => dossierInGestorScope(d, escopo));
      }
    }
    const safe = dossiers.map(({ gov_password_encrypted, cert_email_senha_encrypted, cert_senha_acesso_encrypted, ...d }) => d);
    return NextResponse.json({ dossiers: safe });
  } catch (e) {
    console.error('Erro ao listar dossiês excluídos:', e);
    return NextResponse.json({ error: 'Erro interno.' }, { status: 500 });
  }
}
