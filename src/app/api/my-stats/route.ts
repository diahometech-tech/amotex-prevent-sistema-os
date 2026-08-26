import { NextRequest, NextResponse } from 'next/server';
import { Database } from '@/lib/db';
import { getSessionFromRequest } from '@/lib/auth';

// GET /api/my-stats — estatísticas dos cadastros DO captador logado.
// Retorna apenas contagens (não expõe os dados das OS).
export async function GET(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
  }

  const all = await Database.getDossiers();
  const meus = all.filter((d) => (d.captured_by || '') === session.name);

  const sucesso = meus.filter((d) => d.empresa_aberta || d.status === 'finalizado').length;
  const erro = meus.filter((d) => d.status === 't1_vermelho' || d.status === 'cancelado').length;
  const emProcesso = meus.length - sucesso - erro;

  return NextResponse.json({
    captador: session.name,
    total: meus.length,
    sucesso,
    erro,
    em_processo: emProcesso,
  });
}
