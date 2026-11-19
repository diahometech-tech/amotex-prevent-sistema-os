// Financeiro é só do gestor (admin) — decisão da reunião de 26/10: "o
// administrativo vê faturamento; técnico vê as OS". Um helper só pras rotas.
import type { NextRequest } from 'next/server';
import { getSessionFromRequest } from '../auth';
import { isEscritorio } from '../roles';

export function sessaoFinanceiro(request: NextRequest) {
  const session = getSessionFromRequest(request);
  return session && session.role === 'admin' ? session : null;
}

// Cobranças (19/11): a secretária cuida da rotina de cobrança — gerar o mês,
// marcar enviada, registrar pagamento, anexar comprovante. O resto do
// financeiro (painel, reajustes, ajustes, meta, isentar/editar) segue só do
// gestor; a rota de PATCH ainda confere a ação com podeAcaoCobranca.
export function sessaoCobrancas(request: NextRequest) {
  const session = getSessionFromRequest(request);
  return session && isEscritorio(session.role) ? session : null;
}
