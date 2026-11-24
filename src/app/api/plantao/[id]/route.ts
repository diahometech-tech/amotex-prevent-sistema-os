import { NextRequest, NextResponse } from 'next/server';
import { Database } from '@/lib/db';
import { getSessionFromRequest } from '@/lib/auth';
import { podeGerirPlantao } from '@/lib/roles';
import { atendeCorretiva, erroParaPlantao } from '@/lib/plantao';
import { erroDoPeriodo, normalizarInstante, periodoEncerrado, periodoIniciado, sePeriodosSobrepoem } from '@/lib/plantao-escala';

type RouteContext = { params: Promise<{ id: string }> };

// PATCH /api/plantao/[id] { usuario_id?, inicio?, fim? } — edita um período
// que ainda não terminou. Período que já começou: só o fim muda (pra encurtar
// ou esticar o plantão em andamento). Escritório.
export async function PATCH(request: NextRequest, context: RouteContext) {
  const session = getSessionFromRequest(request);
  if (!session || !podeGerirPlantao(session.role)) {
    return NextResponse.json({ error: 'Apenas o escritório edita a escala de plantão.' }, { status: 403 });
  }
  const { id } = await context.params;
  try {
    const atual = await Database.getPlantaoEscalaById(id);
    if (!atual) return NextResponse.json({ error: 'Período não encontrado.' }, { status: 404 });
    const agora = new Date();
    if (periodoEncerrado(atual, agora)) {
      return NextResponse.json({ error: 'Esse período já terminou e não pode ser alterado.' }, { status: 409 });
    }
    const body = await request.json();
    const iniciado = periodoIniciado(atual, agora);
    if (iniciado && (body?.usuario_id !== undefined || body?.inicio !== undefined)) {
      return NextResponse.json({ error: 'Esse plantão já começou: só dá para mudar o fim.' }, { status: 409 });
    }

    const inicio = body?.inicio !== undefined ? normalizarInstante(body.inicio) : atual.inicio;
    const fim = body?.fim !== undefined ? normalizarInstante(body.fim) : atual.fim;
    if (!inicio || !fim) return NextResponse.json({ error: 'Data ou hora inválida.' }, { status: 400 });
    const erro = erroDoPeriodo(inicio, fim);
    if (erro) return NextResponse.json({ error: erro }, { status: 400 });
    if (new Date(fim).getTime() <= agora.getTime()) {
      return NextResponse.json({ error: 'O fim tem que ser depois de agora. Para cancelar o plantão, exclua o período.' }, { status: 400 });
    }

    let usuarioId = atual.usuario_id;
    if (body?.usuario_id !== undefined && body.usuario_id !== atual.usuario_id) {
      const novo = typeof body.usuario_id === 'string' ? await Database.getUserById(body.usuario_id) : null;
      if (!novo || !atendeCorretiva(novo)) return NextResponse.json({ error: 'Escolha um técnico de corretiva ativo.' }, { status: 400 });
      const semCanal = erroParaPlantao(novo);
      if (semCanal) return NextResponse.json({ error: semCanal }, { status: 400 });
      usuarioId = novo.id;
    }

    const todos = await Database.getPlantaoEscala();
    const conflito = todos.find((p) => p.id !== id && p.usuario_id === usuarioId && sePeriodosSobrepoem(p, { inicio, fim }));
    if (conflito) {
      const u = await Database.getUserById(usuarioId);
      return NextResponse.json({ error: `${u?.nome ?? 'Essa pessoa'} já está de plantão em parte desse intervalo.` }, { status: 409 });
    }

    const periodo = await Database.updatePlantaoEscala(id, { usuario_id: usuarioId, inicio, fim });
    await Database.createAuditLog({
      entidade: 'plantao_escala', entidade_id: id, acao: 'PLANTAO_PERIODO_ALTERADO', ator: session.name,
      detalhe: { de: { usuario_id: atual.usuario_id, inicio: atual.inicio, fim: atual.fim }, para: { usuario_id: usuarioId, inicio, fim } },
    });
    return NextResponse.json({ success: true, periodo });
  } catch (e) {
    console.error('Erro ao editar período de plantão:', e);
    return NextResponse.json({ error: 'Erro interno.' }, { status: 500 });
  }
}

// DELETE /api/plantao/[id] — exclui um período que ainda NÃO começou. Quem já
// está de plantão: edite o fim (encerrar agora). Escritório.
export async function DELETE(request: NextRequest, context: RouteContext) {
  const session = getSessionFromRequest(request);
  if (!session || !podeGerirPlantao(session.role)) {
    return NextResponse.json({ error: 'Apenas o escritório edita a escala de plantão.' }, { status: 403 });
  }
  const { id } = await context.params;
  const atual = await Database.getPlantaoEscalaById(id);
  if (!atual) return NextResponse.json({ error: 'Período não encontrado.' }, { status: 404 });
  if (periodoIniciado(atual, new Date())) {
    return NextResponse.json({ error: 'Esse plantão já começou. Para encerrar, mude o fim para agora.' }, { status: 409 });
  }
  await Database.deletePlantaoEscala(id);
  await Database.createAuditLog({
    entidade: 'plantao_escala', entidade_id: id, acao: 'PLANTAO_PERIODO_EXCLUIDO', ator: session.name,
    detalhe: { usuario_id: atual.usuario_id, inicio: atual.inicio, fim: atual.fim },
  });
  return NextResponse.json({ success: true });
}
