import { NextRequest, NextResponse } from 'next/server';
import { Database } from '@/lib/db';
import { sessaoFinanceiro } from '@/lib/financeiro/acesso';
import { competenciaValida, gerarCobrancasMes, resumoMes } from '@/lib/financeiro/cobranca';
import { hojeISO } from '@/lib/os-agenda';

// GET /api/financeiro/cobrancas?competencia=YYYY-MM — cobranças do mês +
// resumo (mesmos números do topo da aba mensal da planilha). Admin.
export async function GET(request: NextRequest) {
  if (!sessaoFinanceiro(request)) return NextResponse.json({ error: 'Acesso negado.' }, { status: 403 });
  // ?condominio_id= — histórico de um condomínio (página do condomínio).
  const condominioId = request.nextUrl.searchParams.get('condominio_id');
  if (condominioId) {
    return NextResponse.json({ hoje: hojeISO(), cobrancas: await Database.getCobrancasByCondominio(condominioId) });
  }
  const competencia = request.nextUrl.searchParams.get('competencia') || hojeISO().slice(0, 7);
  if (!competenciaValida(competencia)) return NextResponse.json({ error: 'Competência inválida.' }, { status: 400 });

  const hoje = hojeISO();
  const [cobrancas, condominios] = await Promise.all([Database.getCobrancas(competencia), Database.getCondominios()]);
  const preview = gerarCobrancasMes({ competencia, condominios, ajustes: await Database.getAjustes(), existentes: cobrancas });
  return NextResponse.json({
    competencia,
    hoje,
    cobrancas,
    resumo: resumoMes(cobrancas, hoje),
    // Quanto um "Gerar cobranças" agora acrescentaria (0 = mês completo).
    aGerar: preview.novas.length,
    semValor: preview.semValor,
    condominios: condominios.map((c) => ({
      id: c.id, nome: c.nome, cnpj: c.cnpj, emails_cobranca: c.emails_cobranca,
      responsavel_nome: c.responsavel_nome, responsavel_telefone: c.responsavel_telefone,
    })),
  });
}

// POST /api/financeiro/cobrancas { competencia } — gera as cobranças do mês.
// Idempotente (src/lib/financeiro/cobranca.ts): rodar de novo só acrescenta
// condomínio que ainda não tem cobrança no mês.
export async function POST(request: NextRequest) {
  const session = sessaoFinanceiro(request);
  if (!session) return NextResponse.json({ error: 'Acesso negado.' }, { status: 403 });
  try {
    const { competencia } = await request.json();
    if (!competenciaValida(competencia)) return NextResponse.json({ error: 'Competência inválida.' }, { status: 400 });
    const [condominios, ajustes, existentes] = await Promise.all([
      Database.getCondominios(), Database.getAjustes(), Database.getCobrancas(competencia),
    ]);
    const r = gerarCobrancasMes({ competencia, condominios, ajustes, existentes });
    for (const item of r.novas) await Database.createCobranca(item);
    if (r.novas.length) {
      await Database.createAuditLog({
        entidade: 'cobranca', acao: 'COBRANCAS_GERADAS', ator: session.name,
        detalhe: { competencia, criadas: r.novas.length },
      });
    }
    return NextResponse.json({ success: true, criadas: r.novas.length, jaExistiam: r.jaExistiam, semValor: r.semValor });
  } catch (e) {
    console.error('Erro ao gerar cobranças:', e);
    return NextResponse.json({ error: 'Erro interno.' }, { status: 500 });
  }
}
