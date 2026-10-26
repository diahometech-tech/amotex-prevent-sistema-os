import { NextRequest, NextResponse } from 'next/server';
import { Database } from '@/lib/db';
import { sessaoFinanceiro } from '@/lib/financeiro/acesso';
import { calcularValorNovo, percentualSugerido, reajustesPendentes, vigenciaPadrao } from '@/lib/financeiro/reajuste';
import { indicesAcumulados } from '@/lib/financeiro/indices-bcb';
import { competenciaValida } from '@/lib/financeiro/cobranca';
import { emailAtivo } from '@/lib/notify';
import { hojeISO, normalizarDataProgramada } from '@/lib/os-agenda';

// GET /api/financeiro/reajustes — contratos que pedem reajuste (aniversário
// em até 30 dias ou ciclo perdido) com o % sugerido, e os reajustes já
// registrados com o status de cada um (acompanhamento do gestor). Admin.
export async function GET(request: NextRequest) {
  if (!sessaoFinanceiro(request)) return NextResponse.json({ error: 'Acesso negado.' }, { status: 403 });
  const hoje = hojeISO();
  const [condominios, registrados, indices] = await Promise.all([
    Database.getCondominios(), Database.getReajustes(), indicesAcumulados(),
  ]);
  const porId = new Map(condominios.map((c) => [c.id, c]));
  const pendentes = reajustesPendentes(condominios, registrados, hoje).map((p) => {
    const c = porId.get(p.condominio_id)!;
    const sugerido = percentualSugerido(c, indices.valores);
    return { ...p, percentual_sugerido: sugerido, valor_sugerido_centavos: sugerido === null ? null : calcularValorNovo(p.valor_atual_centavos, sugerido) };
  });
  const contato = (id: string) => {
    const c = porId.get(id);
    return c ? { nome: c.nome, responsavel_nome: c.responsavel_nome, responsavel_telefone: c.responsavel_telefone, emails_cobranca: c.emails_cobranca, responsavel_email: c.responsavel_email } : null;
  };
  return NextResponse.json({
    hoje,
    pendentes,
    registrados: [...registrados].sort((a, b) => b.aniversario.localeCompare(a.aniversario)).map((r) => ({ ...r, condominio: contato(r.condominio_id) })),
    indices,
    emailAtivo: emailAtivo(),
    semDataInicio: condominios.filter((c) => c.ativo !== false && !c.contrato_inicio).length,
  });
}

// POST /api/financeiro/reajustes { condominio_id, aniversario, percentual, vigencia?, observacao? }
// Registra a decisão do gestor pro ciclo (status "A enviar"). O % é dele —
// pode ser o sugerido, outro, ou 0.
export async function POST(request: NextRequest) {
  const session = sessaoFinanceiro(request);
  if (!session) return NextResponse.json({ error: 'Acesso negado.' }, { status: 403 });
  try {
    const body = await request.json();
    const c = typeof body.condominio_id === 'string' ? await Database.getCondominioById(body.condominio_id) : null;
    if (!c) return NextResponse.json({ error: 'Condomínio não encontrado.' }, { status: 404 });
    if (!c.valor_mensal_centavos) return NextResponse.json({ error: 'Condomínio sem valor mensal cadastrado.' }, { status: 400 });
    const aniversario = normalizarDataProgramada(body.aniversario);
    if (!aniversario) return NextResponse.json({ error: 'Data de aniversário inválida.' }, { status: 400 });
    const percentual = Number(String(body.percentual).replace(',', '.'));
    if (!Number.isFinite(percentual) || percentual < 0 || percentual > 100) {
      return NextResponse.json({ error: 'Percentual inválido.' }, { status: 400 });
    }
    const hoje = hojeISO();
    const vigencia = body.vigencia ?? vigenciaPadrao(aniversario, hoje);
    if (!competenciaValida(vigencia)) return NextResponse.json({ error: 'Mês de vigência inválido.' }, { status: 400 });
    if (vigencia < hoje.slice(0, 7)) return NextResponse.json({ error: 'O reajuste não pode valer a partir de um mês que já passou.' }, { status: 400 });
    if ((await Database.getReajustes()).some((r) => r.condominio_id === c.id && r.aniversario === aniversario)) {
      return NextResponse.json({ error: 'Reajuste deste ciclo já registrado.' }, { status: 409 });
    }
    const reajuste = await Database.createReajuste({
      condominio_id: c.id, aniversario, valor_atual_centavos: c.valor_mensal_centavos, indice: c.reajuste_indice,
      percentual, valor_novo_centavos: calcularValorNovo(c.valor_mensal_centavos, percentual), vigencia,
      status: 'pendente', observacao: typeof body.observacao === 'string' && body.observacao.trim() ? body.observacao.trim() : undefined,
    });
    await Database.createAuditLog({ entidade: 'reajuste', entidade_id: reajuste.id, acao: 'REAJUSTE_REGISTRADO', ator: session.name, detalhe: { condominio_id: c.id, percentual } });
    return NextResponse.json({ success: true, reajuste });
  } catch (e) {
    console.error('Erro ao registrar reajuste:', e);
    return NextResponse.json({ error: 'Erro interno.' }, { status: 500 });
  }
}
