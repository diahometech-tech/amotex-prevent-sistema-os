import { NextRequest, NextResponse } from 'next/server';
import { Database } from '@/lib/db';
import { getSessionFromRequest, canAccessCondominio } from '@/lib/auth';
import { canEditEquipamento } from '@/lib/permissions';
import { validarEquipamento } from '@/lib/equipamento-campos';
import { saveFotoEquipamentoDataUrl } from '@/lib/uploads';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const session = getSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: 'Sessão expirada.' }, { status: 401 });
  if (!(await canAccessCondominio(session, id))) {
    return NextResponse.json({ error: 'Você não tem acesso a este condomínio.' }, { status: 403 });
  }
  const equipamentos = await Database.getEquipamentosByCondominio(id);
  return NextResponse.json({ equipamentos });
}

// POST — cadastra equipamento do parque de máquinas (feito na visita técnica,
// com foto opcional em `foto` como data URL). Admin ou técnico.
export async function POST(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const session = getSessionFromRequest(request);
  if (!session || !canEditEquipamento(session.role)) {
    return NextResponse.json({ error: 'Acesso negado.' }, { status: 403 });
  }
  try {
    if (!(await Database.getCondominioById(id))) {
      return NextResponse.json({ error: 'Condomínio não encontrado.' }, { status: 404 });
    }
    const body = await request.json();
    const { dados, erro } = validarEquipamento(body ?? {});
    if (erro) return NextResponse.json({ error: erro }, { status: 400 });
    if (typeof body.foto === 'string' && body.foto) {
      const foto = saveFotoEquipamentoDataUrl(body.foto, id);
      if ('erro' in foto) return NextResponse.json({ error: foto.erro }, { status: 400 });
      dados.foto_url = foto.url;
    }
    const equipamento = await Database.createEquipamento({ ...dados, condominio_id: id });
    await Database.createAuditLog({
      entidade: 'equipamento', entidade_id: equipamento.id, acao: 'CRIADO', ator: session.name,
      detalhe: { condominio_id: id, tipo: equipamento.tipo },
    });
    return NextResponse.json({ success: true, equipamento });
  } catch (e) {
    console.error('Erro ao criar equipamento:', e);
    return NextResponse.json({ error: 'Erro interno.' }, { status: 500 });
  }
}
