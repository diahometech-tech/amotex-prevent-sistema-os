import { NextRequest, NextResponse } from 'next/server';
import { Contato, Database } from '@/lib/db';
import { getSessionFromRequest } from '@/lib/auth';

type RouteContext = { params: Promise<{ id: string }> };

const PAPEIS: Contato['papel'][] = ['zelador', 'sindico', 'administradora', 'conservadora', 'plantao'];
const CANAIS: Contato['canal_preferencial'][] = ['telegram', 'whatsapp', 'email'];

// PATCH /api/contatos/[id] — edita contato existente (inclusive ativar/
// desativar, sem apagar o histórico de escalonamento que referencia o
// contato_id). Só admin, mesma regra do POST em condominios/[id]/contatos.
export async function PATCH(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const session = getSessionFromRequest(request);
  if (!session || session.role !== 'admin') {
    return NextResponse.json({ error: 'Apenas administradores podem editar contatos.' }, { status: 403 });
  }
  try {
    const { papel, nome, canal_preferencial, identificador_canal, nivel_escalonamento, ativo } = await request.json();

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
    return NextResponse.json({ success: true, contato });
  } catch (e) {
    console.error('Erro ao editar contato:', e);
    return NextResponse.json({ error: 'Erro interno.' }, { status: 500 });
  }
}
