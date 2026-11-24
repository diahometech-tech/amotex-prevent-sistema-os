import { NextRequest, NextResponse } from 'next/server';
import { Database } from '@/lib/db';
import { getSessionFromRequest } from '@/lib/auth';
import { isEscritorio, podeGerirPlantao, podeVerModulo } from '@/lib/roles';
import { atendeCorretiva, erroParaPlantao, plantonistasEm, temCanalDeAviso } from '@/lib/plantao';
import { erroDoPeriodo, normalizarInstante, periodoEncerrado, periodoIniciado, sePeriodosSobrepoem } from '@/lib/plantao-escala';
import { periodoAtendimento } from '@/lib/horario-comercial';

// GET /api/plantao — quem está de plantão agora e a escala das próximas semanas.
// Escritório vê a escala toda (e a lista de técnicos para montar períodos);
// o técnico só vê quem está de plantão agora e a PRÓPRIA escala. Síndico: 403.
export async function GET(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session || !podeVerModulo(session.role, 'plantao')) {
    return NextResponse.json({ error: 'Acesso negado.' }, { status: 403 });
  }
  const agora = new Date();
  const [escala, users] = await Promise.all([Database.getPlantaoEscala(), Database.getUsers()]);
  const nome = new Map(users.map((u) => [u.id, u.nome]));
  const verTudo = isEscritorio(session.role);

  const atual = plantonistasEm(agora, escala, users);
  const periodos = escala
    .filter((p) => !periodoEncerrado(p, agora))
    .filter((p) => verTudo || p.usuario_id === session.id)
    .map((p) => ({
      id: p.id,
      usuario_id: p.usuario_id,
      usuario_nome: nome.get(p.usuario_id) ?? 'Usuário removido',
      inicio: p.inicio,
      fim: p.fim,
      em_andamento: periodoIniciado(p, agora),
    }));

  return NextResponse.json({
    agora: {
      origem: atual.origem,
      periodo: periodoAtendimento(agora),
      plantonistas: atual.usuarios.map((u) => ({
        id: u.id,
        nome: u.nome,
        ate: atual.ate[u.id] ?? null,
        ...(verTudo ? { sem_canal: !temCanalDeAviso(u) } : {}),
      })),
    },
    periodos,
    ...(verTudo
      ? {
          tecnicos: users
            .filter(atendeCorretiva)
            .map((u) => ({ id: u.id, nome: u.nome, sem_canal: !temCanalDeAviso(u) })),
        }
      : {}),
  });
}

// POST /api/plantao { usuario_id, inicio, fim } — acrescenta um período. Escritório.
// `inicio`/`fim` são instantes ISO (a tela converte do horário de São Paulo).
export async function POST(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session || !podeGerirPlantao(session.role)) {
    return NextResponse.json({ error: 'Apenas o escritório monta a escala de plantão.' }, { status: 403 });
  }
  try {
    const body = await request.json();
    const inicio = normalizarInstante(body?.inicio);
    const fim = normalizarInstante(body?.fim);
    if (!inicio || !fim) return NextResponse.json({ error: 'Informe o início e o fim do plantão.' }, { status: 400 });
    const erro = erroDoPeriodo(inicio, fim);
    if (erro) return NextResponse.json({ error: erro }, { status: 400 });
    if (new Date(fim).getTime() <= Date.now()) {
      return NextResponse.json({ error: 'Esse período já terminou. Informe um que ainda não terminou.' }, { status: 400 });
    }
    const usuario = typeof body?.usuario_id === 'string' ? await Database.getUserById(body.usuario_id) : null;
    if (!usuario || !atendeCorretiva(usuario)) {
      return NextResponse.json({ error: 'Escolha um técnico de corretiva ativo.' }, { status: 400 });
    }
    const semCanal = erroParaPlantao(usuario);
    if (semCanal) return NextResponse.json({ error: semCanal }, { status: 400 });

    const mesmaPessoa = (await Database.getPlantaoEscala()).find((p) => p.usuario_id === usuario.id && sePeriodosSobrepoem(p, { inicio, fim }));
    if (mesmaPessoa) {
      return NextResponse.json({ error: `${usuario.nome} já está de plantão em parte desse intervalo.` }, { status: 409 });
    }
    const periodo = await Database.createPlantaoEscala({ usuario_id: usuario.id, inicio, fim, criado_por: session.name });
    await Database.createAuditLog({
      entidade: 'plantao_escala', entidade_id: periodo.id, acao: 'PLANTAO_PERIODO_CRIADO', ator: session.name,
      detalhe: { usuario: usuario.nome, inicio, fim },
    });
    return NextResponse.json({ success: true, periodo });
  } catch (e) {
    console.error('Erro ao criar período de plantão:', e);
    return NextResponse.json({ error: 'Erro interno.' }, { status: 500 });
  }
}
