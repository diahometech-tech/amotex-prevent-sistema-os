import { NextRequest, NextResponse } from 'next/server';
import { Database, shortId } from '@/lib/db';
import { getSessionFromRequest } from '@/lib/auth';

// POST /api/push/subscribe  body: PushSubscriptionJSON do navegador
// { endpoint, keys: { p256dh, auth } }
export async function POST(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ error: 'Acesso restrito.' }, { status: 403 });
  }
  const body = await request.json().catch(() => ({}));
  const endpoint = body?.endpoint;
  const p256dh = body?.keys?.p256dh;
  const auth = body?.keys?.auth;
  if (!endpoint || !p256dh || !auth) {
    return NextResponse.json({ error: 'Inscrição de push inválida.' }, { status: 400 });
  }
  await Database.insertPushSubscription({
    id: shortId(9),
    user_name: session.name,
    endpoint,
    p256dh,
    auth,
    created_at: new Date().toISOString(),
  });
  return NextResponse.json({ ok: true });
}
