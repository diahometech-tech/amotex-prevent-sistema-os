import { NextRequest, NextResponse } from 'next/server';
import { Database } from '@/lib/db';
import { getSessionFromRequest, canManageUsers } from '@/lib/auth';

// GET /api/activity-logs — trilha de auditoria completa. Só admin.
export async function GET(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session || !canManageUsers(session.role)) {
    return NextResponse.json({ error: 'Acesso restrito a administradores.' }, { status: 403 });
  }
  const logs = await Database.getAuditLogs();
  return NextResponse.json({ logs });
}
