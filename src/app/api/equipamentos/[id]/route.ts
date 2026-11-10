import { NextRequest, NextResponse } from 'next/server';
import { Database } from '@/lib/db';
import { getSessionFromRequest } from '@/lib/auth';
import { canEditEquipamento } from '@/lib/permissions';
import { validarEquipamento } from '@/lib/equipamento-campos';
import { saveFotoEquipamentoDataUrl } from '@/lib/uploads';

type RouteContext = { params: Promise<{ id: string }> };

// PATCH /api/equipamentos/[id] — corrige o cadastro ou troca a foto (`foto`
// como data URL). Admin ou técnico, como o cadastro.
export async function PATCH(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const session = getSessionFromRequest(request);
  if (!session || !canEditEquipamento(session.role)) {
    return NextResponse.json({ error: 'Acesso negado.' }, { status: 403 });
  }
  try {
    const atual = await Database.getEquipamentoById(id);
    if (!atual) return NextResponse.json({ error: 'Equipamento não encontrado.' }, { status: 404 });
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

// DELETE — só admin, e só se nenhuma OS usou o equipamento no checklist (o
// histórico da OS aponta pra ele).
export async function DELETE(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const session = getSessionFromRequest(request);
  if (!session || session.role !== 'admin') {
    return NextResponse.json({ error: 'Só gestores podem remover equipamentos.' }, { status: 403 });
  }
  if (await Database.equipamentoEmUso(id)) {
    return NextResponse.json({ error: 'Este equipamento já aparece em OS e não pode ser removido.' }, { status: 409 });
  }
  const ok = await Database.deleteEquipamento(id);
  if (!ok) return NextResponse.json({ error: 'Equipamento não encontrado.' }, { status: 404 });
  await Database.createAuditLog({ entidade: 'equipamento', entidade_id: id, acao: 'REMOVIDO', ator: session.name });
  return NextResponse.json({ success: true });
}
