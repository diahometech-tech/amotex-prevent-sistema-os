import { NextRequest, NextResponse } from 'next/server';
import { Database } from '@/lib/db';
import { sessaoFinanceiro } from '@/lib/financeiro/acesso';

type RouteContext = { params: Promise<{ id: string }> };

// DELETE /api/financeiro/ajustes/[id] — não mexe em cobranças já geradas.
export async function DELETE(request: NextRequest, context: RouteContext) {
  const session = sessaoFinanceiro(request);
  if (!session) return NextResponse.json({ error: 'Acesso negado.' }, { status: 403 });
  const { id } = await context.params;
  const ok = await Database.deleteAjuste(id);
  if (!ok) return NextResponse.json({ error: 'Ajuste não encontrado.' }, { status: 404 });
  await Database.createAuditLog({ entidade: 'ajuste_valor', entidade_id: id, acao: 'AJUSTE_VALOR_REMOVIDO', ator: session.name });
  return NextResponse.json({ success: true });
}
