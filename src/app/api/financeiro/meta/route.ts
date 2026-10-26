import { NextRequest, NextResponse } from 'next/server';
import { Database } from '@/lib/db';
import { sessaoFinanceiro } from '@/lib/financeiro/acesso';

// PUT /api/financeiro/meta { meta, prazo: 'YYYY-MM' } — meta de condomínios.
export async function PUT(request: NextRequest) {
  const session = sessaoFinanceiro(request);
  if (!session) return NextResponse.json({ error: 'Acesso negado.' }, { status: 403 });
  const { meta, prazo } = await request.json();
  const n = Number(meta);
  if (!Number.isInteger(n) || n < 1 || n > 100000) return NextResponse.json({ error: 'Meta inválida.' }, { status: 400 });
  if (typeof prazo !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(prazo)) return NextResponse.json({ error: 'Prazo inválido.' }, { status: 400 });
  await Database.setConfiguracao('meta_condominios', String(n));
  await Database.setConfiguracao('meta_prazo', prazo);
  await Database.createAuditLog({ entidade: 'configuracao', acao: 'META_ALTERADA', ator: session.name, detalhe: { meta: n, prazo } });
  return NextResponse.json({ success: true });
}
