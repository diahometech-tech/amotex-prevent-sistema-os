import { NextRequest, NextResponse } from 'next/server';
import { Database } from '@/lib/db';
import { canAccessCondominio, filtrarOSVisiveis, getSessionFromRequest, osParaPapel, podeVerOS } from '@/lib/auth';
import { isTecnico, podeAbrirChamado, podeAbrirOS } from '@/lib/roles';
import { checkRateLimit, recordFailure } from '@/lib/rate-limit';
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
  return NextResponse.json({ oss: oss.map((o) => osParaPapel(session.role, o)) });
}

// Chamado pelo Painel do Condomínio: no máximo 5 por hora por usuário.
const CHAMADOS_POR_HORA = 5;
const JANELA_CHAMADOS_MS = 60 * 60_000;

// Síndico (ou zelador/gerente com o acesso do síndico) abre uma CORRETIVA do
// próprio condomínio. O servidor decide tudo: condomínio é o do usuário,
// tipo é corretiva, sem técnico, para hoje, prioridade padrão. Preventiva ou
// outro condomínio = 403. Dados de agenda que vierem no corpo são ignorados.
async function abrirChamadoDoCondominio(session: { id: string; name: string }, body: Record<string, unknown>) {
  const usuario = await Database.getUserById(session.id);
  if (!usuario?.condominio_id) {
    return NextResponse.json({ error: 'Sua conta não está vinculada a um condomínio.' }, { status: 403 });
  }
  if (body.tipo !== undefined && body.tipo !== 'corretiva') {
    return NextResponse.json({ error: 'O condomínio só abre chamado de corretiva. Para outra visita, ligue para a Amotex.' }, { status: 403 });
  }
  if (body.condominio_id !== undefined && body.condominio_id !== usuario.condominio_id) {
    return NextResponse.json({ error: 'Você só pode abrir chamado do seu condomínio.' }, { status: 403 });
  }
  const descricao = textoOpcional(body.descricao_problema)?.slice(0, 1000);
  if (!descricao || descricao.length < 3) {
    return NextResponse.json({ error: 'Conte o que está acontecendo.' }, { status: 400 });
  }
  const chave = `chamado:${session.id}`;
  const limite = checkRateLimit(chave, JANELA_CHAMADOS_MS, CHAMADOS_POR_HORA);
  if (!limite.allowed) {
    return NextResponse.json(
      { error: 'Você abriu muitos chamados em pouco tempo. Se for urgente, ligue para a Amotex.' },
      { status: 429, ...(limite.retryAfterSeconds ? { headers: { 'Retry-After': String(limite.retryAfterSeconds) } } : {}) }
    );
  }
  const condominio = await Database.getCondominioById(usuario.condominio_id);
  if (!condominio) return NextResponse.json({ error: 'Condomínio não encontrado.' }, { status: 404 });

  const os = await Database.createOS({
    condominio_id: condominio.id, tipo: 'corretiva', origem: 'manual', canal_abertura: 'condominio',
    data_programada: hojeISO(),
    solicitante_nome: textoOpcional(body.solicitante_nome)?.slice(0, 120) ?? session.name,
    solicitante_telefone: textoOpcional(body.solicitante_telefone)?.slice(0, 40),
    descricao_problema: descricao,
  }, session.name);
  recordFailure(chave, JANELA_CHAMADOS_MS, CHAMADOS_POR_HORA);
  await criarChecklistInicial(os);
  notifyN8n('os_created', os);
  // Mesmos avisos de qualquer corretiva (horário comercial x plantão). O
  // resultado (quem foi avisado) é interno: o condomínio não recebe.
  await avisarCorretiva('os_corretiva_aberta', os);
  return NextResponse.json({ success: true, os: osParaPapel('sindico', os) });
}

// POST /api/os — cria OS manual. Gestor, secretária ou técnico; o síndico só
// abre chamado de corretiva do próprio condomínio (abrirChamadoDoCondominio).
export async function POST(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session || !(podeAbrirOS(session.role) || podeAbrirChamado(session.role))) {
    return NextResponse.json({ error: 'Acesso negado.' }, { status: 403 });
  }
  try {
    const body = await request.json();
    if (podeAbrirChamado(session.role)) return await abrirChamadoDoCondominio(session, body ?? {});
    const { condominio_id, tipo, prioridade, tecnico_id, observacao } = body;
    if (!condominio_id || (tipo !== 'preventiva' && tipo !== 'corretiva')) {
      return NextResponse.json({ error: 'Informe o condomínio e o tipo da OS.' }, { status: 400 });
    }
    // Técnico só abre OS para si mesmo; passar para outro é do escritório.
    if (isTecnico(session.role) && tecnico_id && tecnico_id !== session.id) {
      return NextResponse.json({ error: 'Só o escritório atribui a OS a outro técnico.' }, { status: 403 });
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
      // Técnico só abre corretiva a partir de preventiva que ele vê (a de outro técnico, no histórico, é só leitura).
      if (isTecnico(session.role) && !(await podeVerOS(session, origem))) {
        return NextResponse.json({ error: 'Sem acesso à preventiva de origem.' }, { status: 403 });
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

    // Técnico abre OS em qualquer condomínio (25/11). A ligação com uma
    // preventiva de origem só exige que ele a veja (a de outro técnico é leitura).
    if (isTecnico(session.role) && !(await canAccessCondominio(session, condominio_id))) {
      const origem = typeof body.os_origem_id === 'string' && body.os_origem_id ? await Database.getOSById(body.os_origem_id) : null;
      if (!origem || !(await podeVerOS(session, origem))) {
        return NextResponse.json({ error: 'Sem acesso a este condomínio.' }, { status: 403 });
      }
    }

    const os = await Database.createOS({
      condominio_id, tipo, prioridade, origem: 'manual', tecnico_id: tecnico_id || undefined, observacao,
      os_origem_id, equipamento_id,
      canal_abertura: isTecnico(session.role) ? 'tecnico' : 'escritorio',
      data_programada: data_programada ?? undefined,
      solicitante_nome: textoOpcional(body.solicitante_nome),
      solicitante_telefone: textoOpcional(body.solicitante_telefone),
      descricao_problema: textoOpcional(body.descricao_problema),
    }, session.name);

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
    const aviso = tipo === 'corretiva' ? await avisarCorretiva('os_corretiva_aberta', os, { ignorarId: isTecnico(session.role) ? session.id : undefined }) : undefined;
    return NextResponse.json({ success: true, os: osParaPapel(session.role, os), ...(aviso ? { aviso } : {}) });
  } catch (e) {
    console.error('Erro ao criar OS:', e);
    return NextResponse.json({ error: 'Erro interno.' }, { status: 500 });
  }
}
