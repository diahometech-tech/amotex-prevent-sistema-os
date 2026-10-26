import { NextRequest, NextResponse } from 'next/server';
import { Database } from '@/lib/db';
import { sessaoFinanceiro } from '@/lib/financeiro/acesso';
import { mensagemLevantamento, pendenciasCadastro } from '@/lib/financeiro/pendencias';

// GET /api/financeiro/pendencias — o que falta no cadastro de cada condomínio
// e a mensagem pronta pra equipe levantar os dados.
export async function GET(request: NextRequest) {
  if (!sessaoFinanceiro(request)) return NextResponse.json({ error: 'Acesso negado.' }, { status: 403 });
  const pendencias = pendenciasCadastro(await Database.getCondominios());
  return NextResponse.json({ pendencias, mensagem: mensagemLevantamento(pendencias) });
}
