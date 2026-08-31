import { NextRequest, NextResponse } from 'next/server';
import { Database } from '@/lib/db';
import { getSessionFromRequest, canManageUsers } from '@/lib/auth';

const LIMITE_PADRAO = 100;
const LIMITE_MAXIMO = 500;

// GET /api/alertas — alertas recebidos (mais recentes primeiro), pro
// "Dashboard Consolidado (Admin)" do PRD. Só admin, mesmo padrão de
// activity-logs/session-logs (visão operacional, não é dado do síndico).
//
// ?limit=N devolve os N mais recentes (padrão 100, teto 500): o histórico
// cresce indefinidamente com a integração SensorLog, então sem teto cada
// carregamento do dashboard ficaria progressivamente mais pesado.
//
// Cada alerta vem com `reservatorio` e `condominio` resolvidos. O alerta
// guarda só reservatorio_id, e sozinho ele não diz nada pra quem lê o
// dashboard ("de qual caixa? de qual condomínio?"). Resolver isso no cliente
// exigiria varrer os reservatórios condomínio a condomínio (N+1); aqui sai
// em duas leituras, independente da quantidade de alertas.
export async function GET(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session || !canManageUsers(session.role)) {
    return NextResponse.json({ error: 'Acesso restrito a administradores.' }, { status: 403 });
  }

  const limitParam = Number(request.nextUrl.searchParams.get('limit'));
  const limit = Number.isFinite(limitParam) && limitParam > 0
    ? Math.min(limitParam, LIMITE_MAXIMO)
    : LIMITE_PADRAO;

  const [todos, reservatorios, condominios] = await Promise.all([
    Database.getAlertas(),
    Database.getReservatorios(),
    Database.getCondominios(),
  ]);

  const porReservatorio = new Map(reservatorios.map((r) => [r.id, r]));
  const porCondominio = new Map(condominios.map((c) => [c.id, c]));

  // Um alerta cujo reservatório não resolve não é descartado: é exatamente o
  // caso de de-para faltando/apagado que o PRD manda nunca engolir em
  // silêncio — chega com reservatorio/condominio nulos pra UI sinalizar.
  const alertas = todos.slice(0, limit).map((a) => {
    const reservatorio = porReservatorio.get(a.reservatorio_id) ?? null;
    const condominio = reservatorio ? porCondominio.get(reservatorio.condominio_id) ?? null : null;
    return {
      ...a,
      reservatorio: reservatorio && { id: reservatorio.id, nome_interno: reservatorio.nome_interno, tipo: reservatorio.tipo },
      condominio: condominio && { id: condominio.id, nome: condominio.nome },
    };
  });

  return NextResponse.json({ alertas });
}
