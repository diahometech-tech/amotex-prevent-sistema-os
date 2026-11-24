import { NextRequest, NextResponse } from 'next/server';
import { Database } from '@/lib/db';
import { getSessionFromRequest } from '@/lib/auth';
import { endpointValido } from '@/lib/push';

// Inscrição de aviso do aparelho (Web Push). Sempre do PRÓPRIO usuário da
// sessão: ninguém inscreve nem remove aparelho de outra pessoa.

async function usuarioAtivo(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session) return null;
  const user = await Database.getUserById(session.id);
  return user && user.ativo ? user : null;
}

function texto(v: unknown, max: number): string | null {
  return typeof v === 'string' && v.length > 0 && v.length <= max ? v : null;
}

// GET /api/push/inscrever?endpoint=... — este aparelho está inscrito para o usuário?
export async function GET(request: NextRequest) {
  const user = await usuarioAtivo(request);
  if (!user) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
  const endpoint = request.nextUrl.searchParams.get('endpoint');
  if (!endpoint) return NextResponse.json({ error: 'Informe o endpoint.' }, { status: 400 });
  const i = await Database.getPushInscricaoByEndpoint(endpoint);
  return NextResponse.json({ inscrito: !!i && i.usuario_id === user.id });
}

// POST /api/push/inscrever — body { endpoint, keys: { p256dh, auth } } (o JSON
// do PushSubscription). Se o aparelho já estava inscrito para outro usuário,
// passa para quem está logado agora.
export async function POST(request: NextRequest) {
  const user = await usuarioAtivo(request);
  if (!user) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
  try {
    const body = await request.json().catch(() => null);
    const sub = body?.subscription ?? body;
    const endpoint = sub?.endpoint;
    const p256dh = texto(sub?.keys?.p256dh, 256);
    const auth = texto(sub?.keys?.auth, 256);
    if (!endpointValido(endpoint) || !p256dh || !auth) {
      return NextResponse.json({ error: 'Inscrição inválida.' }, { status: 400 });
    }
    await Database.salvarPushInscricao({
      usuario_id: user.id,
      endpoint,
      p256dh,
      auth,
      user_agent: (request.headers.get('user-agent') ?? '').slice(0, 300) || undefined,
    });
    return NextResponse.json({ success: true });
  } catch (e) {
    console.error('Erro ao inscrever aparelho:', e);
    return NextResponse.json({ error: 'Erro interno.' }, { status: 500 });
  }
}

// DELETE /api/push/inscrever — body { endpoint }. Só remove se for do usuário
// da sessão; de outra pessoa responde 404 (não revela que existe).
export async function DELETE(request: NextRequest) {
  const user = await usuarioAtivo(request);
  if (!user) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
  try {
    const body = await request.json().catch(() => null);
    const endpoint = body?.endpoint;
    if (typeof endpoint !== 'string' || !endpoint) {
      return NextResponse.json({ error: 'Informe o endpoint.' }, { status: 400 });
    }
    const i = await Database.getPushInscricaoByEndpoint(endpoint);
    if (!i || i.usuario_id !== user.id) {
      return NextResponse.json({ error: 'Inscrição não encontrada.' }, { status: 404 });
    }
    await Database.deletePushInscricaoByEndpoint(endpoint);
    return NextResponse.json({ success: true });
  } catch (e) {
    console.error('Erro ao remover inscrição:', e);
    return NextResponse.json({ error: 'Erro interno.' }, { status: 500 });
  }
}
