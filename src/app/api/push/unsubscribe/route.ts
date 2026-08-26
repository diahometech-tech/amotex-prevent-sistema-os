import { NextRequest, NextResponse } from 'next/server';
import { Database } from '@/lib/db';
import { getSessionFromRequest } from '@/lib/auth';

// POST /api/push/unsubscribe  body: { endpoint }
export async function POST(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ error: 'Sessão expirada.' }, { status: 401 });
  }
  const body = await request.json().catch(() => ({}));
  const endpoint = body?.endpoint;
  if (!endpoint) {
    return NextResponse.json({ error: 'endpoint é obrigatório.' }, { status: 400 });
  }
  await Database.deletePushSubscriptionByEndpoint(endpoint);
  return NextResponse.json({ ok: true });
}
