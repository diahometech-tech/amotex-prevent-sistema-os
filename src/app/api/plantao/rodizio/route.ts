import { NextRequest, NextResponse } from 'next/server';
import { Database } from '@/lib/db';
import { getSessionFromRequest } from '@/lib/auth';
import { podeGerirPlantao } from '@/lib/roles';
import { atendeCorretiva, erroParaPlantao } from '@/lib/plantao';
import { erroDoRodizio, gerarRodizio, sePeriodosSobrepoem } from '@/lib/plantao-escala';
import { hojeISO } from '@/lib/os-agenda';

// POST /api/plantao/rodizio — gera períodos de plantão em rodízio. Escritório.
// Corpo: { usuarios_ids: [ids na ordem], dia_semana: 0..6, hora: 0..23,
// duracao_dias?: 7, semanas, a_partir_de?: 'YYYY-MM-DD', confirmar?: boolean }.
// Sem `confirmar` devolve só a prévia (nada é gravado); com `confirmar: true`
// cria as linhas (recalcula na hora). Período que cruza outro da MESMA pessoa
// é pulado (rodar duas vezes não duplica).
export async function POST(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session || !podeGerirPlantao(session.role)) {
    return NextResponse.json({ error: 'Apenas o escritório monta a escala de plantão.' }, { status: 403 });
  }
  try {
    const body = await request.json();
    const usuarios: string[] = Array.isArray(body?.usuarios_ids) ? body.usuarios_ids.filter((i: unknown) => typeof i === 'string') : [];
    const aPartirDe = typeof body?.a_partir_de === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.a_partir_de) ? body.a_partir_de : undefined;
    const entrada = {
      agora: new Date(),
      usuarios,
      diaSemana: Number(body?.dia_semana),
      hora: Number(body?.hora),
      duracaoDias: body?.duracao_dias === undefined ? 7 : Number(body.duracao_dias),
      semanas: Number(body?.semanas),
      aPartirDe,
    };
    const erro = erroDoRodizio(entrada);
    if (erro) return NextResponse.json({ error: erro }, { status: 400 });
    if (aPartirDe && aPartirDe < hojeISO()) {
      return NextResponse.json({ error: 'A data de início não pode ser no passado.' }, { status: 400 });
    }

    const todos = await Database.getUsers();
    const porId = new Map(todos.map((u) => [u.id, u]));
    for (const id of usuarios) {
      const u = porId.get(id);
      if (!u || !atendeCorretiva(u)) return NextResponse.json({ error: 'Escolha só técnicos de corretiva ativos.' }, { status: 400 });
      const semCanal = erroParaPlantao(u);
      if (semCanal) return NextResponse.json({ error: semCanal }, { status: 400 });
    }

    const existentes = await Database.getPlantaoEscala();
    const gerados = gerarRodizio(entrada);
    const novos = gerados.filter((g) => !existentes.some((p) => p.usuario_id === g.usuario_id && sePeriodosSobrepoem(p, g)));
    const pulados = gerados.length - novos.length;
    const lista = novos.map((g) => ({ ...g, usuario_nome: porId.get(g.usuario_id)?.nome ?? '' }));

    if (body?.confirmar !== true) return NextResponse.json({ periodos: lista, pulados });

    for (const g of novos) {
      await Database.createPlantaoEscala({ ...g, criado_por: session.name });
    }
    await Database.createAuditLog({
      entidade: 'plantao_escala', acao: 'PLANTAO_RODIZIO_GERADO', ator: session.name,
      detalhe: { criados: novos.length, pulados, usuarios: usuarios.map((i) => porId.get(i)?.nome) },
    });
    return NextResponse.json({ success: true, criados: novos.length, pulados });
  } catch (e) {
    console.error('Erro ao gerar rodízio de plantão:', e);
    return NextResponse.json({ error: 'Erro interno.' }, { status: 500 });
  }
}
