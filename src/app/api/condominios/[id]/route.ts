import { NextRequest, NextResponse } from 'next/server';
import { Database } from '@/lib/db';
import { getSessionFromRequest, canAccessCondominio } from '@/lib/auth';
import { validarCadastro } from '@/lib/financeiro/cadastro';
import { hojeISO } from '@/lib/os-agenda';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const session = getSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: 'Sessão expirada.' }, { status: 401 });
  if (!(await canAccessCondominio(session, id))) {
    return NextResponse.json({ error: 'Você não tem acesso a este condomínio.' }, { status: 403 });
  }
  const condominio = await Database.getCondominioById(id);
  if (!condominio) return NextResponse.json({ error: 'Condomínio não encontrado.' }, { status: 404 });

  const [reservatorios, contatos, equipamentos, oss] = await Promise.all([
    Database.getReservatoriosByCondominio(id),
    Database.getContatosByCondominio(id),
    Database.getEquipamentosByCondominio(id),
    Database.getOSsByCondominio(id),
  ]);
  return NextResponse.json({ condominio, reservatorios, contatos, equipamentos, oss });
}

// PATCH /api/condominios/[id] — só admin.
export async function PATCH(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const session = getSessionFromRequest(request);
  if (!session || session.role !== 'admin') {
    return NextResponse.json({ error: 'Apenas administradores podem editar condomínios.' }, { status: 403 });
  }
  try {
    const atual = await Database.getCondominioById(id);
    if (!atual) return NextResponse.json({ error: 'Condomínio não encontrado.' }, { status: 404 });
    const { dados, erro } = validarCadastro(await request.json());
    if (erro) return NextResponse.json({ error: erro }, { status: 400 });
    if (dados.cnpj && dados.cnpj !== atual.cnpj) {
      const outro = (await Database.getCondominios()).find((c) => c.cnpj === dados.cnpj && c.id !== id);
      if (outro) return NextResponse.json({ error: `CNPJ já cadastrado em "${outro.nome}".` }, { status: 409 });
    }
    // Saída da carteira registra a data (painel de crescimento conta as saídas).
    const updates: Record<string, unknown> = { ...dados };
    if (dados.ativo === false && atual.ativo !== false) updates.desativado_em = hojeISO();
    if (dados.ativo === true && atual.ativo === false) updates.desativado_em = null;
    const condominio = await Database.updateCondominio(id, updates);
    const mudou = Object.keys(dados).filter((k) => (dados as Record<string, unknown>)[k] !== (atual as unknown as Record<string, unknown>)[k]);
    if (mudou.length) {
      await Database.createAuditLog({ entidade: 'condominio', entidade_id: id, acao: 'CADASTRO_ALTERADO', ator: session.name, detalhe: { campos: mudou } });
    }
    return NextResponse.json({ success: true, condominio });
  } catch (e) {
    console.error('Erro ao atualizar condomínio:', e);
    return NextResponse.json({ error: 'Erro interno.' }, { status: 500 });
  }
}
