import { NextRequest, NextResponse } from 'next/server';
import { Database } from '@/lib/db';
import { getSessionFromRequest } from '@/lib/auth';

type RouteContext = { params: Promise<{ id: string }> };

// PATCH /api/contatos/[id] — edita contato existente (inclusive ativar/
// desativar, sem apagar o histórico de escalonamento que referencia o
// contato_id). Só admin, mesma regra do POST em condominios/[id]/contatos.
export async function PATCH(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const session = getSessionFromRequest(request);
  if (!session || session.role !== 'admin') {
    return NextResponse.json({ error: 'Apenas administradores podem editar contatos.' }, { status: 403 });
  }
  try {
    const { papel, nome, canal_preferencial, identificador_canal, nivel_escalonamento, ativo } = await request.json();
    const contato = await Database.updateContato(id, {
      papel, nome, canal_preferencial, identificador_canal, nivel_escalonamento, ativo,
    });
    if (!contato) {
      return NextResponse.json({ error: 'Contato não encontrado.' }, { status: 404 });
    }
    return NextResponse.json({ success: true, contato });
  } catch (e) {
    console.error('Erro ao editar contato:', e);
    return NextResponse.json({ error: 'Erro interno.' }, { status: 500 });
  }
}
