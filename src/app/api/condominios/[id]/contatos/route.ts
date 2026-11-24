import { NextRequest, NextResponse } from 'next/server';
import { Database } from '@/lib/db';
import { getSessionFromRequest, canAccessCondominio, podeEditarContatosDoCondominio } from '@/lib/auth';
import { isEscritorio, podeEditarContato, podeEditarContatoEmCampo } from '@/lib/roles';
import { PAPEIS_CONTATO_TECNICO, nivelPadraoDoPapel } from '@/lib/contato-acesso';
import { telefoneDiscavel } from '@/lib/endereco';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const session = getSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: 'Sessão expirada.' }, { status: 401 });
  if (!(await canAccessCondominio(session, id))) {
    return NextResponse.json({ error: 'Você não tem acesso a este condomínio.' }, { status: 403 });
  }
  const contatos = await Database.getContatosByCondominio(id);
  return NextResponse.json({ contatos });
}

// POST — cadastra contato (zelador/gerente/portaria/síndico/administradora/
// conservadora/plantão) com canal preferencial e nível de escalonamento.
// Gestor e secretária: tudo. Técnico (22/11): só nos condomínios das OS
// atribuídas a ele (abertas, ou finalizadas nos últimos 30 dias), só zelador/
// gerente/portaria/síndico, sempre por WhatsApp (telefone) e sem escolher o
// nível de escalonamento — o escritório ajusta a cadeia depois.
export async function POST(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const session = getSessionFromRequest(request);
  if (!session || !podeEditarContatoEmCampo(session.role)) {
    return NextResponse.json({ error: 'Você não pode cadastrar contatos.' }, { status: 403 });
  }
  if (!(await canAccessCondominio(session, id))) {
    return NextResponse.json({ error: 'Você não tem acesso a este condomínio.' }, { status: 403 });
  }
  if (!podeEditarContato(session.role) && !(await podeEditarContatosDoCondominio(session, id))) {
    return NextResponse.json({ error: 'Você só cadastra contato nos condomínios das suas OS.' }, { status: 403 });
  }
  try {
    const corpo = await request.json();
    const { papel, nome } = corpo;
    const { identificador_canal } = corpo;
    let { canal_preferencial, nivel_escalonamento } = corpo;
    if (!isEscritorio(session.role)) {
      if (!PAPEIS_CONTATO_TECNICO.includes(papel)) {
        return NextResponse.json({ error: 'Escolha zelador, gerente, portaria ou síndico.' }, { status: 400 });
      }
      if (typeof nome !== 'string' || nome.trim().length < 2) {
        return NextResponse.json({ error: 'Informe o nome do contato.' }, { status: 400 });
      }
      if (typeof identificador_canal !== 'string' || !telefoneDiscavel(identificador_canal)) {
        return NextResponse.json({ error: 'Telefone inválido. Informe o DDD e o número.' }, { status: 400 });
      }
      canal_preferencial = 'whatsapp';
      nivel_escalonamento = nivelPadraoDoPapel(papel);
    }
    if (!papel || !nome || !canal_preferencial || !identificador_canal || !nivel_escalonamento) {
      return NextResponse.json({ error: 'Preencha papel, nome, canal e nível de escalonamento.' }, { status: 400 });
    }
    const contato = await Database.createContato({
      condominio_id: id,
      papel,
      nome: typeof nome === 'string' ? nome.trim() : nome,
      canal_preferencial,
      identificador_canal: typeof identificador_canal === 'string' ? identificador_canal.trim() : identificador_canal,
      nivel_escalonamento,
    });
    await Database.createAuditLog({
      entidade: 'contato', entidade_id: contato.id, acao: 'CONTATO_CRIADO', ator: session.name,
      detalhe: { condominio_id: id, papel: contato.papel, nome: contato.nome },
    });
    return NextResponse.json({ success: true, contato });
  } catch (e) {
    console.error('Erro ao criar contato:', e);
    return NextResponse.json({ error: 'Erro interno.' }, { status: 500 });
  }
}
