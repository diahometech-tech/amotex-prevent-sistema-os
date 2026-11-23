import { NextRequest, NextResponse } from 'next/server';
import { Database } from '@/lib/db';
import { sessaoCobrancas } from '@/lib/financeiro/acesso';
import { cobrancaAjustavel, competenciaValida, gerarCobrancasMes, resumoMes, vencimentoSugerido, type VencimentoVencidas } from '@/lib/financeiro/cobranca';
import { hojeISO, normalizarDataProgramada } from '@/lib/os-agenda';
import { podeAcaoCobranca } from '@/lib/roles';

// GET /api/financeiro/cobrancas?competencia=YYYY-MM — cobranças do mês +
// resumo (mesmos números do topo da aba mensal da planilha). Gestor e secretária.
export async function GET(request: NextRequest) {
  if (!sessaoCobrancas(request)) return NextResponse.json({ error: 'Acesso negado.' }, { status: 403 });
  // ?condominio_id= — histórico de um condomínio (página do condomínio).
  const condominioId = request.nextUrl.searchParams.get('condominio_id');
  if (condominioId) {
    return NextResponse.json({ hoje: hojeISO(), cobrancas: await Database.getCobrancasByCondominio(condominioId) });
  }
  const competencia = request.nextUrl.searchParams.get('competencia') || hojeISO().slice(0, 7);
  if (!competenciaValida(competencia)) return NextResponse.json({ error: 'Competência inválida.' }, { status: 400 });

  const hoje = hojeISO();
  const [cobrancas, condominios] = await Promise.all([Database.getCobrancas(competencia), Database.getCondominios()]);
  const preview = gerarCobrancasMes({ competencia, condominios, ajustes: await Database.getAjustes(), existentes: cobrancas, hoje });
  return NextResponse.json({
    competencia,
    hoje,
    cobrancas,
    resumo: resumoMes(cobrancas, hoje),
    // Quanto um "Gerar cobranças" agora acrescentaria (0 = mês completo).
    aGerar: preview.novas.length,
    // Das que seriam geradas, quantas já nasceriam vencidas (e em que dia do contrato).
    vencidas: preview.vencidas,
    diasVencidas: preview.diasVencidas,
    vencimentoSugerido: vencimentoSugerido(hoje),
    semValor: preview.semValor,
    condominios: condominios.map((c) => ({
      id: c.id, nome: c.nome, cnpj: c.cnpj, emails_cobranca: c.emails_cobranca,
      responsavel_nome: c.responsavel_nome, responsavel_telefone: c.responsavel_telefone,
    })),
  });
}

// POST /api/financeiro/cobrancas { competencia, vencimento_vencidas? } — gera as
// cobranças do mês. Idempotente (src/lib/financeiro/cobranca.ts): rodar de novo
// só acrescenta condomínio que ainda não tem cobrança no mês.
// vencimento_vencidas: 'manter' (dia do contrato) ou uma data YYYY-MM-DD de hoje
// em diante; vale só para as cobranças NOVAS que já nasceriam vencidas.
export async function POST(request: NextRequest) {
  const session = sessaoCobrancas(request);
  if (!session) return NextResponse.json({ error: 'Acesso negado.' }, { status: 403 });
  try {
    const { competencia, vencimento_vencidas } = await request.json();
    if (!competenciaValida(competencia)) return NextResponse.json({ error: 'Competência inválida.' }, { status: 400 });
    const hoje = hojeISO();
    let vencimentoVencidas: VencimentoVencidas | undefined;
    if (vencimento_vencidas !== undefined && vencimento_vencidas !== null && vencimento_vencidas !== 'manter') {
      const data = normalizarDataProgramada(vencimento_vencidas);
      if (!data) return NextResponse.json({ error: 'Vencimento inválido.' }, { status: 400 });
      if (data < hoje) return NextResponse.json({ error: 'O novo vencimento não pode ser antes de hoje.' }, { status: 400 });
      vencimentoVencidas = { modo: 'data', data };
    }
    const [condominios, ajustes, existentes] = await Promise.all([
      Database.getCondominios(), Database.getAjustes(), Database.getCobrancas(competencia),
    ]);
    const r = gerarCobrancasMes({ competencia, condominios, ajustes, existentes, hoje, vencimentoVencidas });
    for (const item of r.novas) await Database.createCobranca(item);
    if (r.novas.length) {
      await Database.createAuditLog({
        entidade: 'cobranca', acao: 'COBRANCAS_GERADAS', ator: session.name,
        detalhe: {
          competencia, criadas: r.novas.length, vencidas: r.vencidas,
          ...(vencimentoVencidas?.modo === 'data' ? { vencimento_vencidas: vencimentoVencidas.data } : {}),
        },
      });
    }
    return NextResponse.json({ success: true, criadas: r.novas.length, jaExistiam: r.jaExistiam, semValor: r.semValor });
  } catch (e) {
    console.error('Erro ao gerar cobranças:', e);
    return NextResponse.json({ error: 'Erro interno.' }, { status: 500 });
  }
}

// PATCH /api/financeiro/cobrancas { acao: 'ajustar_vencimento', ids: string[], vencimento }
// — troca o vencimento de várias cobranças em aberto (pendente/enviada) de uma
// vez. Gestor e secretária. Cobrança paga ou isenta é pulada (e contada em
// `ignoradas`); nada é alterado no que já foi pago.
export async function PATCH(request: NextRequest) {
  const session = sessaoCobrancas(request);
  if (!session) return NextResponse.json({ error: 'Acesso negado.' }, { status: 403 });
  try {
    const body = await request.json();
    if (body.acao !== 'ajustar_vencimento' || !podeAcaoCobranca(session.role, 'ajustar_vencimento')) {
      return NextResponse.json({ error: 'Ação não permitida.' }, { status: 403 });
    }
    const vencimento = normalizarDataProgramada(body.vencimento);
    if (!vencimento) return NextResponse.json({ error: 'Informe o novo vencimento.' }, { status: 400 });
    const ids: string[] = Array.isArray(body.ids) ? [...new Set<string>(body.ids.filter((i: unknown): i is string => typeof i === 'string'))] : [];
    if (!ids.length) return NextResponse.json({ error: 'Selecione ao menos uma cobrança.' }, { status: 400 });
    if (ids.length > 500) return NextResponse.json({ error: 'Selecione no máximo 500 cobranças por vez.' }, { status: 400 });

    let ajustadas = 0;
    let ignoradas = 0;
    const competencias = new Set<string>();
    for (const id of ids) {
      const atual = await Database.getCobrancaById(id);
      if (!atual || !cobrancaAjustavel(atual)) { ignoradas++; continue; }
      await Database.updateCobranca(id, { vencimento });
      competencias.add(atual.competencia);
      ajustadas++;
    }
    if (ajustadas) {
      await Database.createAuditLog({
        entidade: 'cobranca', acao: 'COBRANCAS_VENCIMENTO_AJUSTADO', ator: session.name,
        detalhe: { vencimento, ajustadas, ignoradas, competencias: [...competencias] },
      });
    }
    return NextResponse.json({ success: true, ajustadas, ignoradas });
  } catch (e) {
    console.error('Erro ao ajustar vencimentos:', e);
    return NextResponse.json({ error: 'Erro interno.' }, { status: 500 });
  }
}
