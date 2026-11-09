import { NextRequest, NextResponse } from 'next/server';
import { Database } from '@/lib/db';
import { sessaoFinanceiro } from '@/lib/financeiro/acesso';
import { competenciaValida } from '@/lib/financeiro/cobranca';
import { parseReais } from '@/lib/financeiro/dinheiro';

// GET /api/financeiro/ajustes?condominio_id= — acréscimos/descontos temporários.
export async function GET(request: NextRequest) {
  if (!sessaoFinanceiro(request)) return NextResponse.json({ error: 'Acesso negado.' }, { status: 403 });
  const condominioId = request.nextUrl.searchParams.get('condominio_id');
  const ajustes = await Database.getAjustes();
  return NextResponse.json({ ajustes: condominioId ? ajustes.filter((a) => a.condominio_id === condominioId) : ajustes });
}

// POST /api/financeiro/ajustes { condominio_id, descricao, valor (R$, negativo = desconto), inicio, fim }
// Ex.: Residencial Congonhas, "Adequação de quadros elétricos", 666,66, 2026-09 a 2026-11.
export async function POST(request: NextRequest) {
  const session = sessaoFinanceiro(request);
  if (!session) return NextResponse.json({ error: 'Acesso negado.' }, { status: 403 });
  try {
    const { condominio_id, descricao, valor, inicio, fim } = await request.json();
    if (!condominio_id || !(await Database.getCondominioById(condominio_id))) {
      return NextResponse.json({ error: 'Condomínio não encontrado.' }, { status: 404 });
    }
    if (typeof descricao !== 'string' || !descricao.trim()) return NextResponse.json({ error: 'Descreva o ajuste.' }, { status: 400 });
    const texto = String(valor ?? '').trim();
    const negativo = texto.startsWith('-');
    const centavos = parseReais(texto.replace(/^-/, ''));
    if (!centavos) return NextResponse.json({ error: 'Valor do ajuste inválido.' }, { status: 400 });
    if (!competenciaValida(inicio) || !competenciaValida(fim) || fim < inicio) {
      return NextResponse.json({ error: 'Período inválido (mês inicial e final).' }, { status: 400 });
    }
    const ajuste = await Database.createAjuste({
      condominio_id, descricao: descricao.trim(), valor_centavos: centavos * (negativo ? -1 : 1), inicio, fim,
    });
    await Database.createAuditLog({ entidade: 'condominio', entidade_id: condominio_id, acao: 'AJUSTE_VALOR_CRIADO', ator: session.name, detalhe: ajuste });
    return NextResponse.json({ success: true, ajuste });
  } catch (e) {
    console.error('Erro ao criar ajuste:', e);
    return NextResponse.json({ error: 'Erro interno.' }, { status: 500 });
  }
}
