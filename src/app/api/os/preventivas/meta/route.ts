import { NextRequest, NextResponse } from 'next/server';
import { Database } from '@/lib/db';
import { getSessionFromRequest } from '@/lib/auth';
import { podePlanejarPreventivas } from '@/lib/roles';
import { calcularReorganizacao } from '@/lib/reorganizar-rotas';
import {
  CHAVE_META_VISITAS, CHAVE_PLANEJAR_SABADO, lerMetaVisitas, lerPlanejarSabado, META_VISITAS_MAX, META_VISITAS_MIN, normalizarMetaVisitas,
} from '@/lib/meta-visitas';

// Meta de visitas preventivas por técnico por dia. Gestor e secretária.
export async function GET(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session || !podePlanejarPreventivas(session.role)) return NextResponse.json({ error: 'Acesso negado.' }, { status: 403 });
  return NextResponse.json({ meta: await lerMetaVisitas(), planejar_sabado: await lerPlanejarSabado() });
}

// PUT { meta?: 1..20, planejar_sabado?: boolean } — pelo menos um dos dois.
export async function PUT(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session || !podePlanejarPreventivas(session.role)) return NextResponse.json({ error: 'Acesso negado.' }, { status: 403 });
  try {
    const body = await request.json();
    if (body?.meta === undefined && body?.planejar_sabado === undefined) {
      return NextResponse.json({ error: 'Nada para salvar.' }, { status: 400 });
    }
    if (body.planejar_sabado !== undefined && typeof body.planejar_sabado !== 'boolean') {
      return NextResponse.json({ error: 'Planejar aos sábados: sim ou não.' }, { status: 400 });
    }
    let n = await lerMetaVisitas();
    if (body.meta !== undefined) {
      const novo = normalizarMetaVisitas(body.meta);
      if (novo === undefined) {
        return NextResponse.json({ error: `A meta deve ser um número inteiro de ${META_VISITAS_MIN} a ${META_VISITAS_MAX}.` }, { status: 400 });
      }
      const anterior = n;
      n = novo;
      await Database.setConfiguracao(CHAVE_META_VISITAS, String(n));
      await Database.createAuditLog({ entidade: 'configuracao', acao: 'META_VISITAS_ALTERADA', ator: session.name, detalhe: { de: anterior, para: n } });
    }
    if (typeof body.planejar_sabado === 'boolean') {
      const anterior = await lerPlanejarSabado();
      await Database.setConfiguracao(CHAVE_PLANEJAR_SABADO, body.planejar_sabado ? '1' : '0');
      await Database.createAuditLog({
        entidade: 'configuracao', acao: 'PLANEJAR_SABADO_ALTERADO', ator: session.name, detalhe: { de: anterior, para: body.planejar_sabado },
      });
    }
    // Efeito da nova meta: quantas visitas a reorganização das 5h vai mudar de dia.
    const { movimentos } = await calcularReorganizacao();
    return NextResponse.json({
      success: true,
      meta: n,
      planejar_sabado: await lerPlanejarSabado(),
      mudariam: movimentos.length,
      acimaDaMeta: movimentos.filter((m) => m.acimaDaMeta).length,
    });
  } catch (e) {
    console.error('Erro ao salvar a meta de visitas:', e);
    return NextResponse.json({ error: 'Erro interno.' }, { status: 500 });
  }
}
