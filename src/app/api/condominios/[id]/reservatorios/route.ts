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
  const reservatorios = await Database.getReservatoriosByCondominio(id);
  return NextResponse.json({ reservatorios });
}

// POST — cadastra reservatório, incluindo o de-para com o nome usado pela
// SensorLog (é a chave que resolve um alerta ao condomínio certo). Só admin.
export async function POST(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const session = getSessionFromRequest(request);
  if (!session || session.role !== 'admin') {
    return NextResponse.json({ error: 'Apenas administradores podem cadastrar reservatórios.' }, { status: 403 });
  }
  try {
    const { nome_interno, nome_sensorlog, tipo, capacidade_litros } = await request.json();
    if (!nome_interno || !nome_sensorlog || !tipo) {
      return NextResponse.json({ error: 'Preencha nome interno, nome na SensorLog e tipo.' }, { status: 400 });
    }
    const existente = await Database.getReservatorioByNomeSensorlog(nome_sensorlog);
    if (existente) {
      return NextResponse.json({ error: 'Já existe um reservatório com esse nome na SensorLog.' }, { status: 409 });
    }
    const reservatorio = await Database.createReservatorio({
      condominio_id: id, nome_interno, nome_sensorlog, tipo, capacidade_litros,
    });
    return NextResponse.json({ success: true, reservatorio });
  } catch (e) {
    console.error('Erro ao criar reservatório:', e);
    return NextResponse.json({ error: 'Erro interno.' }, { status: 500 });
  }
}
