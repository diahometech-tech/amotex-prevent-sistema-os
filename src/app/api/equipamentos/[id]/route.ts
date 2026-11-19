import { NextRequest, NextResponse } from 'next/server';
import { Database } from '@/lib/db';
import { getSessionFromRequest, canAccessCondominio } from '@/lib/auth';
import { podeEditarEquipamento } from '@/lib/roles';
import { validarEquipamento } from '@/lib/equipamento-campos';
import { saveFotoEquipamentoDataUrl } from '@/lib/uploads';

type RouteContext = { params: Promise<{ id: string }> };

// PATCH /api/equipamentos/[id] — corrige o cadastro ou troca a foto (`foto`
// como data URL). Admin ou técnico, como o cadastro.
export async function PATCH(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const session = getSessionFromRequest(request);
  if (!session || !podeEditarEquipamento(session.role)) {
    return NextResponse.json({ error: 'Acesso negado.' }, { status: 403 });
  }
  try {
    const atual = await Database.getEquipamentoById(id);
    if (!atual) return NextResponse.json({ error: 'Equipamento não encontrado.' }, { status: 404 });
    if (!(await canAccessCondominio(session, atual.condominio_id))) {
      return NextResponse.json({ error: 'Você não tem acesso a este condomínio.' }, { status: 403 });
    }
    const body = await request.json();
    const { dados, erro } = validarEquipamento(body ?? {}, true);
    if (erro) return NextResponse.json({ error: erro }, { status: 400 });
    if (typeof body.foto === 'string' && body.foto) {
      const foto = saveFotoEquipamentoDataUrl(body.foto, atual.condominio_id);
      if ('erro' in foto) return NextResponse.json({ error: foto.erro }, { status: 400 });
      dados.foto_url = foto.url;
    }
    const equipamento = await Database.updateEquipamento(id, dados);
    await Database.createAuditLog({
      entidade: 'equipamento', entidade_id: id, acao: 'ATUALIZADO', ator: session.name,
      detalhe: { campos: Object.keys(dados) },
    });
    return NextResponse.json({ success: true, equipamento });
  } catch (e) {
    console.error('Erro ao atualizar equipamento:', e);
    return NextResponse.json({ error: 'Erro interno.' }, { status: 500 });
  }
}

// DELETE — admin ou quem cadastra equipamento (técnico, que pode ter errado o
// cadastro dentro da OS). Só sem histórico: foto, serviço concluído ou OS
// encerrada travam a remoção; os itens "Inspecionar …" ainda abertos saem junto.
export async function DELETE(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const session = getSessionFromRequest(request);
  if (!session || (session.role !== 'admin' && !podeEditarEquipamento(session.role))) {
    return NextResponse.json({ error: 'Acesso negado.' }, { status: 403 });
  }
  try {
    const atual = await Database.getEquipamentoById(id);
    if (!atual) return NextResponse.json({ error: 'Equipamento não encontrado.' }, { status: 404 });
    if (!(await canAccessCondominio(session, atual.condominio_id))) {
      return NextResponse.json({ error: 'Você não tem acesso a este condomínio.' }, { status: 403 });
    }
    const r = await Database.removerEquipamentoSemHistorico(id);
    if (r === 'nao_encontrado') return NextResponse.json({ error: 'Equipamento não encontrado.' }, { status: 404 });
    if (r === 'em_uso') {
      return NextResponse.json(
        { error: 'Este equipamento já tem foto ou serviço registrado e não pode ser removido.' },
        { status: 409 }
      );
    }
    await Database.createAuditLog({ entidade: 'equipamento', entidade_id: id, acao: 'REMOVIDO', ator: session.name });
    return NextResponse.json({ success: true });
  } catch (e) {
    console.error('Erro ao remover equipamento:', e);
    return NextResponse.json({ error: 'Erro interno.' }, { status: 500 });
  }
}
