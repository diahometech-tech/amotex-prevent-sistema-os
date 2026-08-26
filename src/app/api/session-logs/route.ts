import { NextRequest, NextResponse } from 'next/server';
import { Database } from '@/lib/db';
import { getSessionFromRequest, canManageUsers } from '@/lib/auth';

// GET /api/session-logs — log de login/logout com IP. Só admin.
export async function GET(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session || !canManageUsers(session.role)) {
    return NextResponse.json({ error: 'Acesso restrito a administradores.' }, { status: 403 });
  }
  const logs = await Database.getSessionLogs();
  return NextResponse.json({ logs });
}
