import { NextRequest, NextResponse } from 'next/server';
import { Database } from '@/lib/db';
import { getSessionFromRequest, canAccessCondominio } from '@/lib/auth';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const session = getSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: 'Sessão expirada.' }, { status: 401 });
  if (!(await canAccessCondominio(session, id))) {
    return NextResponse.json({ error: 'Você não tem acesso a este condomínio.' }, { status: 403 });
  }
  const condominio = await Database.getCondominioById(id);
  if (!condominio) return NextResponse.json({ error: 'Condomínio não encontrado.' }, { status: 404 });

  const [reservatorios, contatos, equipamentos, oss] = await Promise.all([
    Database.getReservatoriosByCondominio(id),
    Database.getContatosByCondominio(id),
    Database.getEquipamentosByCondominio(id),
    Database.getOSsByCondominio(id),
  ]);
  return NextResponse.json({ condominio, reservatorios, contatos, equipamentos, oss });
}

// PATCH /api/condominios/[id] — só admin.
export async function PATCH(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const session = getSessionFromRequest(request);
  if (!session || session.role !== 'admin') {
    return NextResponse.json({ error: 'Apenas administradores podem editar condomínios.' }, { status: 403 });
  }
  try {
    const { nome, endereco, administradora, monitoramento_ativo } = await request.json();
    const condominio = await Database.updateCondominio(id, { nome, endereco, administradora, monitoramento_ativo });
    if (!condominio) return NextResponse.json({ error: 'Condomínio não encontrado.' }, { status: 404 });
    return NextResponse.json({ success: true, condominio });
  } catch (e) {
    console.error('Erro ao atualizar condomínio:', e);
    return NextResponse.json({ error: 'Erro interno.' }, { status: 500 });
  }
}
