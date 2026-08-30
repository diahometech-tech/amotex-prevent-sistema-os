import { NextRequest, NextResponse } from 'next/server';
import { Database, Reservatorio } from '@/lib/db';
import { getSessionFromRequest } from '@/lib/auth';

type RouteContext = { params: Promise<{ id: string }> };

const TIPOS: Reservatorio['tipo'][] = ['cisterna', 'superior', 'torre'];

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

    // PATCH é atualização parcial: campo ausente é permitido, mas campo
    // presente e vazio corromperia o registro — stripUndefined em db.ts só
    // filtra undefined, então "" passaria direto pro banco se não barrarmos
    // aqui, igual ao POST já faz.
    const camposTexto: [string, unknown][] = [
      ['nome interno', nome_interno],
      ['nome na SensorLog', nome_sensorlog],
      ['tipo', tipo],
    ];
    for (const [campo, valor] of camposTexto) {
      if (valor !== undefined && (typeof valor !== 'string' || valor.trim() === '')) {
        return NextResponse.json({ error: `Campo "${campo}" não pode ficar em branco.` }, { status: 400 });
      }
    }
    if (tipo !== undefined && !TIPOS.includes(tipo)) {
      return NextResponse.json({ error: 'Tipo de reservatório inválido.' }, { status: 400 });
    }
    // capacidade_litros: null é aceito de propósito (limpa o valor
    // cadastrado); qualquer outro valor precisa ser número positivo.
    if (
      capacidade_litros !== undefined && capacidade_litros !== null &&
      (typeof capacidade_litros !== 'number' || !Number.isFinite(capacidade_litros) || capacidade_litros <= 0)
    ) {
      return NextResponse.json({ error: 'Capacidade em litros deve ser um número positivo.' }, { status: 400 });
    }
    if (
      nome_interno === undefined && nome_sensorlog === undefined &&
      tipo === undefined && capacidade_litros === undefined
    ) {
      return NextResponse.json({ error: 'Nenhum campo para atualizar foi enviado.' }, { status: 400 });
    }

    // nome_sensorlog é a chave que resolve um alerta da SensorLog ao
    // condomínio certo (UNIQUE no schema) — mesma checagem do POST, mas
    // excluindo o próprio registro da comparação. A validação acima já
    // garante que, se presente, não chega vazio até aqui (senão a checagem
    // ficaria falsy e passaria batido, deixando o reservatório sem chave
    // de resolução de alerta).
    if (nome_sensorlog !== undefined) {
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
