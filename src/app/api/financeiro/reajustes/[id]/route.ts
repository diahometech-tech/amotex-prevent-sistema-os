import { NextRequest, NextResponse } from 'next/server';
import { Database, type Reajuste } from '@/lib/db';
import { sessaoFinanceiro } from '@/lib/financeiro/acesso';
import { calcularValorNovo, textoAvisoReajuste } from '@/lib/financeiro/reajuste';
import { ajustesDaCompetencia, competenciaValida } from '@/lib/financeiro/cobranca';
import { emailAtivo, notifyN8nEvento } from '@/lib/notify';
import { hojeISO } from '@/lib/os-agenda';

type RouteContext = { params: Promise<{ id: string }> };

// PATCH /api/financeiro/reajustes/[id] { acao, ... }
//   atualizar       — { percentual?, vigencia?, observacao? } (antes de aplicar)
//   enviar_email    — manda o aviso pelos e-mails de cobrança (via n8n) e marca enviado
//   marcar_enviado  — aviso mandado por fora (WhatsApp, e-mail manual)
//   aceito          — APLICA: valor mensal do contrato vira o novo, e as
//                     cobranças ainda pendentes a partir da vigência também
//   recusado | adiado — { observacao } ("a gente combina no ano que vem")
export async function PATCH(request: NextRequest, context: RouteContext) {
  const session = sessaoFinanceiro(request);
  if (!session) return NextResponse.json({ error: 'Acesso negado.' }, { status: 403 });
  const { id } = await context.params;
  const atual = await Database.getReajusteById(id);
  if (!atual) return NextResponse.json({ error: 'Reajuste não encontrado.' }, { status: 404 });
  const condominio = await Database.getCondominioById(atual.condominio_id);
  if (!condominio) return NextResponse.json({ error: 'Condomínio não encontrado.' }, { status: 404 });

  try {
    const body = await request.json();
    const obs = typeof body.observacao === 'string' && body.observacao.trim() ? body.observacao.trim() : undefined;
    const updates: Partial<Reajuste> = {};
    if (atual.status === 'aceito' && body.acao !== 'atualizar_obs') {
      return NextResponse.json({ error: 'Reajuste já aplicado.' }, { status: 400 });
    }

    switch (body.acao) {
      case 'atualizar': {
        if (body.percentual !== undefined) {
          const p = Number(String(body.percentual).replace(',', '.'));
          if (!Number.isFinite(p) || p < 0 || p > 100) return NextResponse.json({ error: 'Percentual inválido.' }, { status: 400 });
          updates.percentual = p;
          updates.valor_novo_centavos = calcularValorNovo(atual.valor_atual_centavos, p);
        }
        if (body.vigencia !== undefined) {
          if (!competenciaValida(body.vigencia)) return NextResponse.json({ error: 'Mês de vigência inválido.' }, { status: 400 });
          if (body.vigencia < hojeISO().slice(0, 7)) {
            return NextResponse.json({ error: 'O reajuste não pode valer a partir de um mês que já passou.' }, { status: 400 });
          }
          updates.vigencia = body.vigencia;
        }
        if (obs !== undefined) updates.observacao = obs;
        break;
      }
      case 'enviar_email': {
        if (!emailAtivo()) {
          return NextResponse.json(
            { error: 'Envio de e-mail ainda não configurado. Copie o texto, envie pelo seu e-mail ou WhatsApp e marque como enviado.' },
            { status: 400 }
          );
        }
        const para = condominio.emails_cobranca || condominio.responsavel_email;
        if (!para) return NextResponse.json({ error: 'Condomínio sem e-mail de cobrança cadastrado.' }, { status: 400 });
        const aviso = textoAvisoReajuste({
          nomeCondominio: condominio.nome, responsavel: condominio.responsavel_nome, aniversario: atual.aniversario,
          vigencia: atual.vigencia, indice: atual.indice, percentual: atual.percentual,
          valorAtual: atual.valor_atual_centavos, valorNovo: atual.valor_novo_centavos,
        });
        notifyN8nEvento('email_enviar', {
          para: para.split(';').map((e) => e.trim()).filter(Boolean),
          assunto: aviso.assunto,
          texto: aviso.texto,
          referencia: { tipo: 'reajuste', id },
        });
        Object.assign(updates, { status: 'enviado', enviado_em: new Date().toISOString() });
        break;
      }
      case 'marcar_enviado':
        Object.assign(updates, { status: 'enviado', enviado_em: new Date().toISOString() });
        break;
      case 'aceito': {
        Object.assign(updates, { status: 'aceito', decidido_em: new Date().toISOString(), ...(obs ? { observacao: obs } : {}) });
        await Database.updateCondominio(condominio.id, { valor_mensal_centavos: atual.valor_novo_centavos });
        // Cobranças já geradas da vigência em diante, ainda não mandadas nem
        // pagas, passam a usar o valor novo (+ ajustes temporários do mês).
        const ajustes = await Database.getAjustes();
        const cobrancas = await Database.getCobrancasByCondominio(condominio.id);
        for (const cb of cobrancas) {
          if (cb.competencia < atual.vigencia || cb.status !== 'pendente') continue;
          const extra = ajustesDaCompetencia(ajustes, condominio.id, cb.competencia).reduce((acc, a) => acc + a.valor_centavos, 0);
          await Database.updateCobranca(cb.id, { valor_previsto_centavos: Math.max(0, atual.valor_novo_centavos + extra) });
        }
        break;
      }
      case 'recusado':
      case 'adiado':
        Object.assign(updates, { status: body.acao, decidido_em: new Date().toISOString(), ...(obs ? { observacao: obs } : {}) });
        break;
      default:
        return NextResponse.json({ error: 'Ação inválida.' }, { status: 400 });
    }

    const reajuste = await Database.updateReajuste(id, updates);
    await Database.createAuditLog({
      entidade: 'reajuste', entidade_id: id, acao: `REAJUSTE_${String(body.acao).toUpperCase()}`, ator: session.name,
      detalhe: { condominio_id: condominio.id, percentual: reajuste?.percentual, status: reajuste?.status },
    });
    return NextResponse.json({ success: true, reajuste });
  } catch (e) {
    console.error('Erro ao atualizar reajuste:', e);
    return NextResponse.json({ error: 'Erro interno.' }, { status: 500 });
  }
}
