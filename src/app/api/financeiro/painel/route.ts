import { NextRequest, NextResponse } from 'next/server';
import { Database } from '@/lib/db';
import { sessaoFinanceiro } from '@/lib/financeiro/acesso';
import { condominioAtivo, resumoMes, somarMeses, statusEfetivo } from '@/lib/financeiro/cobranca';
import { evolucaoCarteira, projetarMeta, serieMensal, ultimasCompetencias } from '@/lib/financeiro/painel';
import { reajustesPendentes } from '@/lib/financeiro/reajuste';
import { pendenciasCadastro } from '@/lib/financeiro/pendencias';
import { lerMeta } from '@/lib/financeiro/meta';
import { hojeISO } from '@/lib/os-agenda';

// GET /api/financeiro/painel — dashboard do gestor: receita mês a mês
// (previsto × recebido), carteira (ativos, novos, saídas), inadimplência,
// reajustes pendentes e projeção até a meta de condomínios. Só receita.
export async function GET(request: NextRequest) {
  if (!sessaoFinanceiro(request)) return NextResponse.json({ error: 'Acesso negado.' }, { status: 403 });
  const hoje = hojeISO();
  const atual = hoje.slice(0, 7);
  const [condominios, cobrancas, reajustes, meta] = await Promise.all([
    Database.getCondominios(), Database.getCobrancas(), Database.getReajustes(), lerMeta(),
  ]);
  const competencias = ultimasCompetencias(atual, 12);
  const carteira = evolucaoCarteira(condominios, competencias);
  // Receita: 9 meses pra trás + 3 à frente — as cobranças do mês seguinte já
  // existem (são geradas no começo do mês) e o gestor quer ver o que vem.
  const competenciasReceita = ultimasCompetencias(somarMeses(atual, 3), 12);
  const ativos = condominios.filter(condominioAtivo);
  const atrasadas = cobrancas.filter((c) => statusEfetivo(c, hoje) === 'atrasada');
  const receitaMensal = ativos.reduce((acc, c) => acc + (c.valor_mensal_centavos ?? 0), 0);
  const comValor = ativos.filter((c) => c.valor_mensal_centavos).length;
  return NextResponse.json({
    hoje,
    competencia: atual,
    kpis: {
      ativos: ativos.length,
      receitaMensal,
      receitaAnual: receitaMensal * 12,
      ticketMedio: comValor ? Math.round(receitaMensal / comValor) : 0,
      novosNoMes: carteira.at(-1)?.novos ?? 0,
      saidasNoMes: carteira.at(-1)?.saidas ?? 0,
      inadimplenciaValor: atrasadas.reduce((acc, c) => acc + c.valor_previsto_centavos - (c.valor_recebido_centavos ?? 0), 0),
      inadimplenciaCondominios: new Set(atrasadas.map((c) => c.condominio_id)).size,
      reajustesPendentes: reajustesPendentes(condominios, reajustes, hoje).length,
      reajustesAguardando: reajustes.filter((r) => r.status === 'pendente' || r.status === 'enviado').length,
      cadastrosIncompletos: pendenciasCadastro(condominios).length,
      // Sem data de início, a entrada na carteira cai na data do cadastro —
      // uma importação em lote vira "N novos no mês" e infla o ritmo da
      // projeção. A tela avisa quando isso pesa.
      semDataInicio: ativos.filter((c) => !c.contrato_inicio).length,
    },
    mesAtual: resumoMes(cobrancas.filter((c) => c.competencia === atual), hoje),
    serie: serieMensal(cobrancas, competenciasReceita, hoje),
    carteira,
    projecao: projetarMeta(carteira, meta.meta, meta.prazo),
  });
}
