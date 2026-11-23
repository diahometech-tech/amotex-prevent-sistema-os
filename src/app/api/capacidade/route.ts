import { NextRequest, NextResponse } from 'next/server';
import { Database } from '@/lib/db';
import { getSessionFromRequest } from '@/lib/auth';
import { isAdmin } from '@/lib/roles';
import { hojeISO } from '@/lib/os-agenda';
import { calcularCapacidade } from '@/lib/capacidade';
import { tecnicosDePreventiva } from '@/lib/planejamento-preventiva';
import { lerDiasUteisPreventiva, lerMetaVisitas } from '@/lib/meta-visitas';
import { lerMeta } from '@/lib/financeiro/meta';

// GET /api/capacidade — gráfico de capacidade do Dashboard. Só o gestor (admin).
export async function GET(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session || !isAdmin(session.role)) return NextResponse.json({ error: 'Acesso negado.' }, { status: 403 });
  try {
    const [condominios, users, oss, meta, carteira, diasUteis] = await Promise.all([
      Database.getCondominios(), Database.getUsers(), Database.getOSs(), lerMetaVisitas(), lerMeta(), lerDiasUteisPreventiva(),
    ]);
    const resultado = calcularCapacidade({
      hoje: hojeISO(),
      oss,
      condominios: condominios.filter((c) => c.ativo !== false),
      tecnicos: tecnicosDePreventiva(users).map((u) => u.id),
      meta,
      metaCarteira: carteira.meta,
      diasUteis,
    });
    return NextResponse.json(resultado);
  } catch (e) {
    console.error('Erro ao calcular a capacidade:', e);
    return NextResponse.json({ error: 'Erro interno.' }, { status: 500 });
  }
}
