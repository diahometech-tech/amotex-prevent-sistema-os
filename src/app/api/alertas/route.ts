import { NextRequest, NextResponse } from 'next/server';
import { Database } from '@/lib/db';
import { getSessionFromRequest, canManageUsers } from '@/lib/auth';

// GET /api/alertas — alertas recebidos (mais recentes primeiro), pro
// "Dashboard Consolidado (Admin)" do PRD. Só admin, mesmo padrão de
// activity-logs/session-logs (visão operacional, não é dado do síndico).
export async function GET(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session || !canManageUsers(session.role)) {
    return NextResponse.json({ error: 'Acesso restrito a administradores.' }, { status: 403 });
  }
  const alertas = await Database.getAlertas();
  return NextResponse.json({ alertas });
}
