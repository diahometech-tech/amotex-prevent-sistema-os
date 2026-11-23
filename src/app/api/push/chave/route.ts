import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth';
import { chavePublicaPush } from '@/lib/push';

// GET /api/push/chave — chave PÚBLICA para o navegador criar a inscrição de
// aviso. A privada nunca sai do servidor (src/lib/push.ts). Exige sessão só
// para não gerar o par à toa; a chave em si não é segredo.
export async function GET(request: NextRequest) {
  if (!getSessionFromRequest(request)) {
    return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
  }
  try {
    return NextResponse.json({ chave: await chavePublicaPush() }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    console.error('Erro ao obter chave de push:', e);
    return NextResponse.json({ error: 'Erro interno.' }, { status: 500 });
  }
}
