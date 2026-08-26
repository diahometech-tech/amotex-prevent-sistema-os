import { NextRequest, NextResponse } from 'next/server';
import { Database } from '@/lib/db';
import { getSessionFromRequest } from '@/lib/auth';

// GET /api/session-logs
// Log de sessões (login/logout com IP) — base do "Log de Acessos". Só
// gestor/admin, mesmo nível de sensibilidade da trilha de auditoria por OS.
export async function GET(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session || (session.role !== 'gestor' && session.role !== 'admin')) {
    return NextResponse.json({ error: 'Acesso restrito a gestor/admin.' }, { status: 403 });
  }
  const logs = await Database.getSessionLogs();
  return NextResponse.json({ logs });
}
