import { NextRequest, NextResponse } from 'next/server';
import { Database } from '@/lib/db';
import { getSessionFromRequest } from '@/lib/auth';
import { enviarPushUsuarios } from '@/lib/push';

// POST /api/push/teste — manda um aviso de teste só para o próprio usuário.
export async function POST(request: NextRequest) {
  const session = getSessionFromRequest(request);
  const user = session ? await Database.getUserById(session.id) : null;
  if (!user || !user.ativo) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });

  const inscricoes = await Database.getPushInscricoesByUsuarios([user.id]);
  if (inscricoes.length === 0) {
    return NextResponse.json({ error: 'Os avisos ainda não estão ligados neste celular.' }, { status: 409 });
  }
  const r = await enviarPushUsuarios([user.id], {
    titulo: 'Aviso de teste',
    corpo: 'Está funcionando. Você vai receber os avisos de OS por aqui.',
    url: '/',
    tag: 'teste',
  });
  if (r.enviados === 0) {
    return NextResponse.json(
      { error: 'Não deu para enviar o aviso. Desligue e ligue os avisos de novo.' },
      { status: 502 }
    );
  }
  return NextResponse.json({ success: true, enviados: r.enviados });
}
