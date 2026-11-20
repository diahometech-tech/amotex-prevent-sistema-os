import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth';
import { podePlanejarPreventivas } from '@/lib/roles';
import { aplicarReorganizacao, calcularReorganizacao } from '@/lib/reorganizar-rotas';

// POST /api/os/preventivas/reorganizar — gestor e secretária.
// Corpo: { confirmar?: boolean }. Sem `confirmar` devolve só a prévia do que
// muda (nada é gravado); com `confirmar: true` aplica (recalcula na hora, não
// confia na prévia do cliente). Manual no expediente: o que já é de hoje fica
// em hoje (manterHoje); a rotina das 5h é que move as sobras de hoje. Regra em src/lib/reorganizar-fila.ts. A mesma
// reorganização roda sozinha às 5h pela rotina /api/integracoes/reorganizar-rotas.
export async function POST(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session || !podePlanejarPreventivas(session.role)) {
    return NextResponse.json({ error: 'Apenas o escritório reorganiza a rota de preventivas.' }, { status: 403 });
  }
  try {
    const body = await request.json().catch(() => ({}));
    if (body?.confirmar === true) {
      const { meta, movimentos } = await aplicarReorganizacao(session.name, undefined, { manterHoje: true });
      return NextResponse.json({ success: true, meta, movimentos, remarcadas: movimentos.length });
    }
    const { meta, movimentos } = await calcularReorganizacao(undefined, { manterHoje: true });
    return NextResponse.json({ meta, movimentos });
  } catch (e) {
    console.error('Erro ao reorganizar rotas:', e);
    return NextResponse.json({ error: 'Erro interno.' }, { status: 500 });
  }
}
