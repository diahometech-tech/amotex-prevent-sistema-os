import { NextRequest, NextResponse } from 'next/server';
import { Database } from '@/lib/db';
import { getSessionFromRequest, isScopedToOwnCondominio } from '@/lib/auth';
import { notifyN8n } from '@/lib/notify';
import { CHECKLIST_PADRAO } from '@/lib/checklist-padrao';
import { hojeISO, normalizarDataProgramada } from '@/lib/os-agenda';

function textoOpcional(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

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
    const body = await request.json();
    const { condominio_id, tipo, prioridade, tecnico_id, observacao } = body;
    if (!condominio_id || (tipo !== 'preventiva' && tipo !== 'corretiva')) {
      return NextResponse.json({ error: 'Informe o condomínio e o tipo da OS.' }, { status: 400 });
    }
    const condominio = await Database.getCondominioById(condominio_id);
    if (!condominio) return NextResponse.json({ error: 'Condomínio não encontrado.' }, { status: 404 });

    // Corretiva sem data informada entra na rota de HOJE: é chamado com
    // problema acontecendo, não pode ficar fora da rota de ninguém.
    let data_programada = normalizarDataProgramada(body.data_programada ?? null);
    if (data_programada === undefined) {
      return NextResponse.json({ error: 'Data da visita inválida.' }, { status: 400 });
    }
    if (!data_programada && tipo === 'corretiva') data_programada = hojeISO();

    const os = await Database.createOS({
      condominio_id, tipo, prioridade, origem: 'manual', tecnico_id: tecnico_id || undefined, observacao,
      data_programada: data_programada ?? undefined,
      solicitante_nome: textoOpcional(body.solicitante_nome),
      solicitante_telefone: textoOpcional(body.solicitante_telefone),
      descricao_problema: textoOpcional(body.descricao_problema),
    });

    // Checklist inicial: roteiro padrão do tipo (src/lib/checklist-padrao.ts)
    // + um item por equipamento cadastrado no condomínio. O técnico ainda
    // pode acrescentar itens na hora — o roteiro é guiado, não travado.
    for (const item of CHECKLIST_PADRAO[tipo as 'preventiva' | 'corretiva']) {
      await Database.createChecklistItem({ os_id: os.id, descricao: item.descricao, obrigatorio: item.obrigatorio });
    }
    const equipamentos = await Database.getEquipamentosByCondominio(condominio_id);
    for (const eq of equipamentos) {
      await Database.createChecklistItem({
        os_id: os.id,
        equipamento_id: eq.id,
        descricao: `Inspecionar ${eq.tipo}${eq.modelo ? ` (${eq.modelo})` : ''}`,
        // Na corretiva o foco é o defeito chamado — inspecionar cada
        // equipamento do prédio fica como item opcional, não trava o fechamento.
        obrigatorio: tipo === 'preventiva',
      });
    }

    notifyN8n('os_created', os);
    return NextResponse.json({ success: true, os });
  } catch (e) {
    console.error('Erro ao criar OS:', e);
    return NextResponse.json({ error: 'Erro interno.' }, { status: 500 });
  }
}
