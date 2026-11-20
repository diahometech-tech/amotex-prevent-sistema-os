import { NextRequest, NextResponse } from 'next/server';
import { Database } from '@/lib/db';
import { canAccessCondominio, filtrarOSVisiveis, getSessionFromRequest, podeVerOS } from '@/lib/auth';
import { isTecnico, podeAbrirOS } from '@/lib/roles';
import { notifyN8n } from '@/lib/notify';
import { avisarCorretiva } from '@/lib/notificacao-corretiva';
import { criarChecklistInicial } from '@/lib/os-checklist-inicial';
import { hojeISO, normalizarDataProgramada } from '@/lib/os-agenda';

function textoOpcional(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

// GET /api/os — lista OS, já filtrada pelo papel (filtrarOSVisiveis): escritório
// vê todas; técnico só as dele + corretivas sem técnico; síndico só as do
// próprio condomínio. Filtro opcional ?condominio_id= (o síndico é limitado
// ao dele pelo próprio filtro de visibilidade).
export async function GET(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: 'Sessão expirada.' }, { status: 401 });

  const condominioId = request.nextUrl.searchParams.get('condominio_id');
  const todas = condominioId ? await Database.getOSsByCondominio(condominioId) : await Database.getOSs();
  const oss = await filtrarOSVisiveis(session, todas);
  return NextResponse.json({ oss });
}

// POST /api/os — cria OS manual. Gestor, secretária ou técnico.
export async function POST(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session || !podeAbrirOS(session.role)) {
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
    // Agendar o dia é do escritório: a OS que o técnico abre é sempre de hoje.
    if (isTecnico(session.role)) data_programada = hojeISO();

    // Corretiva aberta de dentro da preventiva (pedido 10): liga à preventiva
    // de origem e, se informado, ao equipamento com defeito. Os dois têm que
    // ser do mesmo condomínio.
    let os_origem_id: string | undefined;
    let equipamento_id: string | undefined;
    if (body.os_origem_id !== undefined && body.os_origem_id !== null && body.os_origem_id !== '') {
      if (tipo !== 'corretiva') {
        return NextResponse.json({ error: 'Só corretiva pode ser aberta a partir de outra OS.' }, { status: 400 });
      }
      const origem = typeof body.os_origem_id === 'string' ? await Database.getOSById(body.os_origem_id) : null;
      if (!origem || origem.condominio_id !== condominio_id || origem.tipo !== 'preventiva') {
        return NextResponse.json({ error: 'Preventiva de origem inválida.' }, { status: 400 });
      }
      if (origem.status === 'cancelada') {
        return NextResponse.json({ error: 'A preventiva de origem está cancelada.' }, { status: 400 });
      }
      os_origem_id = origem.id;
    }
    if (body.equipamento_id !== undefined && body.equipamento_id !== null && body.equipamento_id !== '') {
      const equipamentos = await Database.getEquipamentosByCondominio(condominio_id);
      if (typeof body.equipamento_id !== 'string' || !equipamentos.some((e) => e.id === body.equipamento_id)) {
        return NextResponse.json({ error: 'Equipamento não pertence a este condomínio.' }, { status: 400 });
      }
      equipamento_id = body.equipamento_id;
    }

    // Técnico só abre OS em condomínio que ele acessa (onde tem OS visível).
    // Exceção: corretiva ligada a uma preventiva que ele vê.
    if (isTecnico(session.role) && !(await canAccessCondominio(session, condominio_id))) {
      const origem = typeof body.os_origem_id === 'string' && body.os_origem_id ? await Database.getOSById(body.os_origem_id) : null;
      if (!origem || !(await podeVerOS(session, origem))) {
        return NextResponse.json({ error: 'Sem acesso a este condomínio.' }, { status: 403 });
      }
    }

    const os = await Database.createOS({
      condominio_id, tipo, prioridade, origem: 'manual', tecnico_id: tecnico_id || undefined, observacao,
      os_origem_id, equipamento_id,
      data_programada: data_programada ?? undefined,
      solicitante_nome: textoOpcional(body.solicitante_nome),
      solicitante_telefone: textoOpcional(body.solicitante_telefone),
      descricao_problema: textoOpcional(body.descricao_problema),
    });

    await criarChecklistInicial(os);
    if (os_origem_id) {
      await Database.createAuditLog({
        entidade: 'os', entidade_id: os_origem_id, acao: 'CORRETIVA_ABERTA', ator: session.name,
        detalhe: { corretiva_id: os.id, equipamento_id: equipamento_id ?? null },
      });
    }

    notifyN8n('os_created', os);
    // Toda corretiva é urgente (prazo de 3h pra chegada): avisa técnicos de
    // corretiva e gestores no Telegram. O resultado volta pra tela dizer a
    // quem chegou — ou por que não chegou.
    const aviso = tipo === 'corretiva' ? await avisarCorretiva('os_corretiva_aberta', os) : undefined;
    return NextResponse.json({ success: true, os, ...(aviso ? { aviso } : {}) });
  } catch (e) {
    console.error('Erro ao criar OS:', e);
    return NextResponse.json({ error: 'Erro interno.' }, { status: 500 });
  }
}
