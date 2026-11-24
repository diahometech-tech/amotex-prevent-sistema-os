import { NextRequest, NextResponse } from 'next/server';
import { Contato, Database } from '@/lib/db';
import { getSessionFromRequest, podeEditarContatosDoCondominio } from '@/lib/auth';
import { isEscritorio, podeEditarContatoEmCampo } from '@/lib/roles';
import { PAPEIS_CONTATO_TECNICO } from '@/lib/contato-acesso';
import { telefoneDiscavel } from '@/lib/endereco';

type RouteContext = { params: Promise<{ id: string }> };

const PAPEIS: Contato['papel'][] = ['zelador', 'gerente', 'portaria', 'sindico', 'administradora', 'conservadora', 'plantao'];
const CANAIS: Contato['canal_preferencial'][] = ['telegram', 'whatsapp', 'email'];

// PATCH /api/contatos/[id] — edita contato existente (inclusive ativar/
// desativar, sem apagar o histórico de escalonamento que referencia o
// contato_id). Gestor e secretária: tudo, em qualquer condomínio. Técnico
// (22/11): só nome, papel (zelador/gerente/portaria/síndico) e telefone, de
// contato por WhatsApp, e só nos condomínios das OS atribuídas a ele. Não mexe
// em nível de escalonamento, canal nem ativo (e não exclui).
export async function PATCH(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const session = getSessionFromRequest(request);
  if (!session || !podeEditarContatoEmCampo(session.role)) {
    return NextResponse.json({ error: 'Você não pode editar contatos.' }, { status: 403 });
  }
  try {
    const { papel, nome, canal_preferencial, identificador_canal, nivel_escalonamento, ativo } = await request.json();

    if (!isEscritorio(session.role)) {
      // Técnico: o contato tem que existir, ser de um condomínio das OS dele e
      // ser de WhatsApp; só nome, papel e telefone mudam.
      const atual = (await Database.getContatosAtivos()).find((c) => c.id === id) ?? null;
      if (!atual || !(await podeEditarContatosDoCondominio(session, atual.condominio_id))) {
        return NextResponse.json({ error: 'Você só edita contato dos condomínios das suas OS.' }, { status: 403 });
      }
      if (atual.canal_preferencial !== 'whatsapp') {
        return NextResponse.json({ error: 'Este contato só o escritório edita.' }, { status: 403 });
      }
      if (canal_preferencial !== undefined || nivel_escalonamento !== undefined || ativo !== undefined) {
        return NextResponse.json({ error: 'Só o escritório muda o nível, o canal ou desativa um contato.' }, { status: 403 });
      }
      if (papel !== undefined && !PAPEIS_CONTATO_TECNICO.includes(papel)) {
        return NextResponse.json({ error: 'Escolha zelador, gerente, portaria ou síndico.' }, { status: 400 });
      }
      if (identificador_canal !== undefined && (typeof identificador_canal !== 'string' || !telefoneDiscavel(identificador_canal))) {
        return NextResponse.json({ error: 'Telefone inválido. Informe o DDD e o número.' }, { status: 400 });
      }
    }

    // PATCH é atualização parcial: campo ausente é permitido (não mexe no
    // que já existe), mas campo presente e vazio corromperia o registro —
    // stripUndefined em db.ts só filtra undefined, então "" ou 0 passam
    // direto pro banco se não barrarmos aqui, igual ao POST já faz.
    const camposTexto: [string, unknown][] = [
      ['papel', papel],
      ['nome', nome],
      ['canal preferencial', canal_preferencial],
      ['identificador do canal', identificador_canal],
    ];
    for (const [campo, valor] of camposTexto) {
      if (valor !== undefined && (typeof valor !== 'string' || valor.trim() === '')) {
        return NextResponse.json({ error: `Campo "${campo}" não pode ficar em branco.` }, { status: 400 });
      }
    }
    if (papel !== undefined && !PAPEIS.includes(papel)) {
      return NextResponse.json({ error: 'Papel inválido.' }, { status: 400 });
    }
    if (canal_preferencial !== undefined && !CANAIS.includes(canal_preferencial)) {
      return NextResponse.json({ error: 'Canal preferencial inválido.' }, { status: 400 });
    }
    if (nivel_escalonamento !== undefined && ![1, 2, 3].includes(nivel_escalonamento)) {
      return NextResponse.json({ error: 'Nível de escalonamento deve ser 1, 2 ou 3.' }, { status: 400 });
    }
    if (ativo !== undefined && typeof ativo !== 'boolean') {
      return NextResponse.json({ error: 'Campo "ativo" deve ser verdadeiro ou falso.' }, { status: 400 });
    }
    if (
      papel === undefined && nome === undefined && canal_preferencial === undefined &&
      identificador_canal === undefined && nivel_escalonamento === undefined && ativo === undefined
    ) {
      return NextResponse.json({ error: 'Nenhum campo para atualizar foi enviado.' }, { status: 400 });
    }

    const contato = await Database.updateContato(id, {
      papel, nome, canal_preferencial, identificador_canal, nivel_escalonamento, ativo,
    });
    if (!contato) {
      return NextResponse.json({ error: 'Contato não encontrado.' }, { status: 404 });
    }
    await Database.createAuditLog({
      entidade: 'contato', entidade_id: id, acao: 'CONTATO_EDITADO', ator: session.name,
      detalhe: {
        condominio_id: contato.condominio_id,
        campos: Object.entries({ papel, nome, canal_preferencial, identificador_canal, nivel_escalonamento, ativo })
          .filter(([, v]) => v !== undefined).map(([k]) => k),
      },
    });
    return NextResponse.json({ success: true, contato });
  } catch (e) {
    console.error('Erro ao editar contato:', e);
    return NextResponse.json({ error: 'Erro interno.' }, { status: 500 });
  }
}
