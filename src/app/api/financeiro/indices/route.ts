import { NextRequest, NextResponse } from 'next/server';
import { sessaoFinanceiro } from '@/lib/financeiro/acesso';
import { indicesAcumulados } from '@/lib/financeiro/indices-bcb';

// GET /api/financeiro/indices — IGP-M, IPCA e INPC acumulados em 12 meses.
export async function GET(request: NextRequest) {
  if (!sessaoFinanceiro(request)) return NextResponse.json({ error: 'Acesso negado.' }, { status: 403 });
  return NextResponse.json(await indicesAcumulados());
}
