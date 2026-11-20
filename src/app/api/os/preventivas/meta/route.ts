import { NextRequest, NextResponse } from 'next/server';
import { Database } from '@/lib/db';
import { getSessionFromRequest } from '@/lib/auth';
import { podePlanejarPreventivas } from '@/lib/roles';
import { calcularReorganizacao } from '@/lib/reorganizar-rotas';
import { CHAVE_META_VISITAS, lerMetaVisitas, META_VISITAS_MAX, META_VISITAS_MIN, normalizarMetaVisitas } from '@/lib/meta-visitas';

// Meta de visitas preventivas por técnico por dia. Gestor e secretária.
export async function GET(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session || !podePlanejarPreventivas(session.role)) return NextResponse.json({ error: 'Acesso negado.' }, { status: 403 });
  return NextResponse.json({ meta: await lerMetaVisitas() });
}

// PUT { meta: 1..20 }
export async function PUT(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session || !podePlanejarPreventivas(session.role)) return NextResponse.json({ error: 'Acesso negado.' }, { status: 403 });
  try {
    const { meta } = await request.json();
    const n = normalizarMetaVisitas(meta);
    if (n === undefined) {
      return NextResponse.json({ error: `A meta deve ser um número inteiro de ${META_VISITAS_MIN} a ${META_VISITAS_MAX}.` }, { status: 400 });
    }
    const anterior = await lerMetaVisitas();
    await Database.setConfiguracao(CHAVE_META_VISITAS, String(n));
    await Database.createAuditLog({ entidade: 'configuracao', acao: 'META_VISITAS_ALTERADA', ator: session.name, detalhe: { de: anterior, para: n } });
    // Efeito da nova meta: quantas visitas a reorganização das 5h vai mudar de dia.
    const { movimentos } = await calcularReorganizacao();
    return NextResponse.json({
      success: true,
      meta: n,
      mudariam: movimentos.length,
      acimaDaMeta: movimentos.filter((m) => m.acimaDaMeta).length,
    });
  } catch (e) {
    console.error('Erro ao salvar a meta de visitas:', e);
    return NextResponse.json({ error: 'Erro interno.' }, { status: 500 });
  }
}
