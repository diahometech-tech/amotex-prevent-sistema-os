import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth';

// GET /api/push/vapid-public-key — chave pública VAPID, usada pelo navegador
// pra assinar a inscrição de push (PushManager.subscribe). Não é segredo (é
// literalmente pública), mas mantém a exigência de sessão por consistência
// com o resto da API.
export async function GET(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ error: 'Acesso restrito.' }, { status: 403 });
  }
  const key = process.env.VAPID_PUBLIC_KEY;
  if (!key) {
    return NextResponse.json({ error: 'Push não configurado no servidor.' }, { status: 501 });
  }
  return NextResponse.json({ publicKey: key });
}
