import { NextRequest, NextResponse } from 'next/server';
import { Database } from '@/lib/db';
import { getSessionFromRequest } from '@/lib/auth';

type RouteContext = { params: Promise<{ id: string }> };

// PATCH /api/reservatorios/[id] — edita reservatório existente. Só admin,
// mesma regra do POST em condominios/[id]/reservatorios.
export async function PATCH(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const session = getSessionFromRequest(request);
  if (!session || session.role !== 'admin') {
    return NextResponse.json({ error: 'Apenas administradores podem editar reservatórios.' }, { status: 403 });
  }
  try {
    const { nome_interno, nome_sensorlog, tipo, capacidade_litros } = await request.json();

    // nome_sensorlog é a chave que resolve um alerta da SensorLog ao
    // condomínio certo (UNIQUE no schema) — mesma checagem do POST, mas
    // excluindo o próprio registro da comparação.
    if (nome_sensorlog) {
      const existente = await Database.getReservatorioByNomeSensorlog(nome_sensorlog);
      if (existente && existente.id !== id) {
        return NextResponse.json({ error: 'Já existe um reservatório com esse nome na SensorLog.' }, { status: 409 });
      }
    }

    const reservatorio = await Database.updateReservatorio(id, {
      nome_interno, nome_sensorlog, tipo, capacidade_litros,
    });
    if (!reservatorio) {
      return NextResponse.json({ error: 'Reservatório não encontrado.' }, { status: 404 });
    }
    return NextResponse.json({ success: true, reservatorio });
  } catch (e) {
    console.error('Erro ao editar reservatório:', e);
    return NextResponse.json({ error: 'Erro interno.' }, { status: 500 });
  }
}
