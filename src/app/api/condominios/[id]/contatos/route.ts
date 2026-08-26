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
  const contatos = await Database.getContatosByCondominio(id);
  return NextResponse.json({ contatos });
}

// POST — cadastra contato (zelador/síndico/administradora/conservadora/plantão)
// com canal preferencial e nível de escalonamento. Só admin.
export async function POST(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const session = getSessionFromRequest(request);
  if (!session || session.role !== 'admin') {
    return NextResponse.json({ error: 'Apenas administradores podem cadastrar contatos.' }, { status: 403 });
  }
  try {
    const { papel, nome, canal_preferencial, identificador_canal, nivel_escalonamento } = await request.json();
    if (!papel || !nome || !canal_preferencial || !identificador_canal || !nivel_escalonamento) {
      return NextResponse.json({ error: 'Preencha papel, nome, canal e nível de escalonamento.' }, { status: 400 });
    }
    const contato = await Database.createContato({
      condominio_id: id, papel, nome, canal_preferencial, identificador_canal, nivel_escalonamento,
    });
    return NextResponse.json({ success: true, contato });
  } catch (e) {
    console.error('Erro ao criar contato:', e);
    return NextResponse.json({ error: 'Erro interno.' }, { status: 500 });
  }
}
