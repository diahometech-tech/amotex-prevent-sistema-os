// Financeiro é só do gestor (admin) — decisão da reunião de 26/10: "o
// administrativo vê faturamento; técnico vê as OS". Um helper só pras rotas.
import type { NextRequest } from 'next/server';
import { getSessionFromRequest } from '../auth';

export function sessaoFinanceiro(request: NextRequest) {
  const session = getSessionFromRequest(request);
  return session && session.role === 'admin' ? session : null;
}
