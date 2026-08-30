import { NextRequest, NextResponse } from 'next/server';
import { Database } from '@/lib/db';
import { getSessionFromRequest, canManageUsers } from '@/lib/auth';

// GET /api/alertas — alertas recebidos (mais recentes primeiro), pro
// "Dashboard Consolidado (Admin)" do PRD. Só admin, mesmo padrão de
// activity-logs/session-logs (visão operacional, não é dado do síndico).
//
// ?limit=N limita a resposta aos N alertas mais recentes (padrão 100, máximo 500).
// Sem limite explícito, o histórico de alertas cresceria indefinidamente via integração
// SensorLog, tornando cada carregamento do dashboard progressivamente mais lento.
export async function GET(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session || !canManageUsers(session.role)) {
    return NextResponse.json({ error: 'Acesso restrito a administradores.' }, { status: 403 });
  }

  // Parse limit parameter: default 100, max 500
  const limitParam = request.nextUrl.searchParams.get('limit');
  let limit = 100;
  if (limitParam) {
    const parsed = parseInt(limitParam, 10);
    if (!isNaN(parsed) && parsed > 0) {
      limit = Math.min(parsed, 500);
    }
  }

  const alertas = await Database.getAlertas();
  return NextResponse.json({ alertas: alertas.slice(0, limit) });
}
