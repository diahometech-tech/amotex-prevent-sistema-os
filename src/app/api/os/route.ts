import { NextRequest, NextResponse } from 'next/server';
import { Database } from '@/lib/db';
import { getSessionFromRequest, isScopedToOwnCondominio } from '@/lib/auth';
import { notifyN8n } from '@/lib/notify';

// GET /api/os — lista OS. Síndico só vê as do próprio condomínio.
// Filtro opcional ?condominio_id= (ignorado se o usuário for síndico).
export async function GET(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: 'Sessão expirada.' }, { status: 401 });

  if (isScopedToOwnCondominio(session.role)) {
    const user = await Database.getUserById(session.id);
    if (!user?.condominio_id) return NextResponse.json({ oss: [] });
    const oss = await Database.getOSsByCondominio(user.condominio_id);
    return NextResponse.json({ oss });
  }

  const condominioId = request.nextUrl.searchParams.get('condominio_id');
  const oss = condominioId ? await Database.getOSsByCondominio(condominioId) : await Database.getOSs();
  return NextResponse.json({ oss });
}

// POST /api/os — cria OS manual. Admin ou técnico.
export async function POST(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session || (session.role !== 'admin' && session.role !== 'tecnico')) {
    return NextResponse.json({ error: 'Acesso negado.' }, { status: 403 });
  }
  try {
    const { condominio_id, tipo, prioridade, tecnico_id, observacao } = await request.json();
    if (!condominio_id || !tipo) {
      return NextResponse.json({ error: 'Informe o condomínio e o tipo da OS.' }, { status: 400 });
    }
    const condominio = await Database.getCondominioById(condominio_id);
    if (!condominio) return NextResponse.json({ error: 'Condomínio não encontrado.' }, { status: 404 });

    const os = await Database.createOS({ condominio_id, tipo, prioridade, origem: 'manual', tecnico_id, observacao });

    // Checklist inicial a partir dos equipamentos já cadastrados do condomínio
    // — dá pro técnico ajustar (adicionar/remover item) depois, não é travado.
    const equipamentos = await Database.getEquipamentosByCondominio(condominio_id);
    for (const eq of equipamentos) {
      await Database.createChecklistItem({
        os_id: os.id,
        equipamento_id: eq.id,
        descricao: `Inspecionar ${eq.tipo}${eq.modelo ? ` (${eq.modelo})` : ''}`,
        obrigatorio: true,
      });
    }

    notifyN8n('os_created', os);
    return NextResponse.json({ success: true, os });
  } catch (e) {
    console.error('Erro ao criar OS:', e);
    return NextResponse.json({ error: 'Erro interno.' }, { status: 500 });
  }
}
