import { NextRequest, NextResponse } from 'next/server';
import { Database } from '@/lib/db';
import { getSessionFromRequest } from '@/lib/auth';
import { isAdmin } from '@/lib/roles';
import { CHAVE_INSPECAO, lerInspecaoObrigatoria, normalizarBooleano } from '@/lib/inspecao-equipamento';

// Configuração "Inspeção dos equipamentos obrigatória" por tipo de OS. Só o gestor.
export async function GET(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session || !isAdmin(session.role)) return NextResponse.json({ error: 'Acesso negado.' }, { status: 403 });
  return NextResponse.json(await lerInspecaoObrigatoria());
}

// PUT { preventiva: boolean, corretiva: boolean } — só vale para OS criadas daqui em diante.
export async function PUT(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session || !isAdmin(session.role)) return NextResponse.json({ error: 'Acesso negado.' }, { status: 403 });
  try {
    const body = await request.json();
    const preventiva = normalizarBooleano(body?.preventiva);
    const corretiva = normalizarBooleano(body?.corretiva);
    if (preventiva === undefined || corretiva === undefined) {
      return NextResponse.json({ error: 'Informe sim ou não para a preventiva e para a corretiva.' }, { status: 400 });
    }
    const anterior = await lerInspecaoObrigatoria();
    await Database.setConfiguracao(CHAVE_INSPECAO.preventiva, String(preventiva));
    await Database.setConfiguracao(CHAVE_INSPECAO.corretiva, String(corretiva));
    await Database.createAuditLog({
      entidade: 'configuracao', acao: 'INSPECAO_EQUIPAMENTO_ALTERADA', ator: session.name,
      detalhe: { de: anterior, para: { preventiva, corretiva } },
    });
    return NextResponse.json({ success: true, preventiva, corretiva });
  } catch (e) {
    console.error('Erro ao salvar a inspeção obrigatória:', e);
    return NextResponse.json({ error: 'Erro interno.' }, { status: 500 });
  }
}
