import { NextRequest, NextResponse } from 'next/server';
import { Database, type Cobranca, type FormaPagamento } from '@/lib/db';
import { sessaoFinanceiro } from '@/lib/financeiro/acesso';
import { FORMAS_PAGAMENTO, nomeComprovante } from '@/lib/financeiro/cobranca';
import { parseReais } from '@/lib/financeiro/dinheiro';
import { normalizarDataProgramada } from '@/lib/os-agenda';
import { saveComprovanteDataUrl } from '@/lib/uploads';

type RouteContext = { params: Promise<{ id: string }> };

const FORMAS = new Set<string>(FORMAS_PAGAMENTO.map(([v]) => v));

// PATCH /api/financeiro/cobrancas/[id] { acao, ... } — o dia a dia da aba
// mensal da planilha:
//   marcar_enviada        — cobrança (boleto/nota) mandada ao condomínio
//   registrar_pagamento   — { pago_em, valor_recebido, forma_pagamento, comprovante? (data URL) }
//   anexar_comprovante    — { comprovante }
//   isentar               — mês sem cobrança; { observacao? }
//   reabrir               — volta pra pendente e limpa pagamento (lançou errado)
//   editar                — { valor_previsto?, vencimento?, observacao? }
export async function PATCH(request: NextRequest, context: RouteContext) {
  const session = sessaoFinanceiro(request);
  if (!session) return NextResponse.json({ error: 'Acesso negado.' }, { status: 403 });
  const { id } = await context.params;
  const atual = await Database.getCobrancaById(id);
  if (!atual) return NextResponse.json({ error: 'Cobrança não encontrada.' }, { status: 404 });

  try {
    const body = await request.json();
    const updates: Partial<Cobranca> = {};
    const comprovante = async () => {
      if (typeof body.comprovante !== 'string' || !body.comprovante) return null;
      const condominio = await Database.getCondominioById(atual.condominio_id);
      const r = saveComprovanteDataUrl(body.comprovante, id, nomeComprovante(condominio?.nome ?? 'Condominio', atual.competencia));
      if ('erro' in r) throw new ErroUsuario(r.erro);
      return r.url;
    };

    switch (body.acao) {
      case 'marcar_enviada':
        if (atual.status === 'paga' || atual.status === 'isenta') throw new ErroUsuario('Cobrança já encerrada.');
        Object.assign(updates, { status: 'enviada', enviada_em: new Date().toISOString() });
        break;
      case 'registrar_pagamento': {
        const pago_em = normalizarDataProgramada(body.pago_em);
        if (!pago_em) throw new ErroUsuario('Informe a data do pagamento.');
        const valor = parseReais(body.valor_recebido);
        if (valor === null || valor === 0) throw new ErroUsuario('Informe o valor recebido.');
        if (!FORMAS.has(body.forma_pagamento)) throw new ErroUsuario('Informe a forma de pagamento.');
        const url = await comprovante();
        Object.assign(updates, {
          status: 'paga', pago_em, valor_recebido_centavos: valor, forma_pagamento: body.forma_pagamento as FormaPagamento,
          ...(url ? { comprovante_url: url } : {}),
        });
        break;
      }
      case 'anexar_comprovante': {
        const url = await comprovante();
        if (!url) throw new ErroUsuario('Selecione o arquivo do comprovante.');
        updates.comprovante_url = url;
        break;
      }
      case 'isentar':
        Object.assign(updates, { status: 'isenta', observacao: typeof body.observacao === 'string' && body.observacao.trim() ? body.observacao.trim() : atual.observacao });
        break;
      case 'reabrir':
        // null limpa no Postgres (buildSet grava null) e no JSON (stripUndefined mantém null).
        Object.assign(updates, {
          status: atual.enviada_em ? 'enviada' : 'pendente',
          pago_em: null, valor_recebido_centavos: null, forma_pagamento: null,
        } as unknown as Partial<Cobranca>);
        break;
      case 'editar': {
        if (body.valor_previsto !== undefined) {
          const v = parseReais(body.valor_previsto);
          if (v === null) throw new ErroUsuario('Valor previsto inválido.');
          updates.valor_previsto_centavos = v;
        }
        if (body.vencimento !== undefined) {
          const d = normalizarDataProgramada(body.vencimento);
          if (!d) throw new ErroUsuario('Vencimento inválido.');
          updates.vencimento = d;
        }
        if (body.observacao !== undefined) updates.observacao = typeof body.observacao === 'string' ? body.observacao.trim() : undefined;
        break;
      }
      default:
        throw new ErroUsuario('Ação inválida.');
    }

    const cobranca = await Database.updateCobranca(id, updates);
    await Database.createAuditLog({
      entidade: 'cobranca', entidade_id: id, acao: `COBRANCA_${String(body.acao).toUpperCase()}`, ator: session.name,
      detalhe: { competencia: atual.competencia, condominio_id: atual.condominio_id, de: atual.status, para: cobranca?.status },
    });
    return NextResponse.json({ success: true, cobranca });
  } catch (e) {
    if (e instanceof ErroUsuario) return NextResponse.json({ error: e.message }, { status: 400 });
    console.error('Erro ao atualizar cobrança:', e);
    return NextResponse.json({ error: 'Erro interno.' }, { status: 500 });
  }
}

class ErroUsuario extends Error {}
