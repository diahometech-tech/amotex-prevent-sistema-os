import { NextRequest, NextResponse } from 'next/server';
import { Database } from '@/lib/db';
import { getSessionFromRequest, isScopedToOwnCondominio } from '@/lib/auth';
import { validarCadastro } from '@/lib/financeiro/cadastro';

// GET /api/condominios — lista condomínios. Síndico só vê o próprio.
export async function GET(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: 'Sessão expirada.' }, { status: 401 });

  const all = await Database.getCondominios();
  if (isScopedToOwnCondominio(session.role)) {
    const user = await Database.getUserById(session.id);
    const own = all.filter((c) => c.id === user?.condominio_id);
    return NextResponse.json({ condominios: own });
  }
  return NextResponse.json({ condominios: all });
}

// POST /api/condominios — cria condomínio. Só admin.
export async function POST(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session || session.role !== 'admin') {
    return NextResponse.json({ error: 'Apenas administradores podem cadastrar condomínios.' }, { status: 403 });
  }
  try {
    const { dados, erro } = validarCadastro(await request.json());
    if (erro) return NextResponse.json({ error: erro }, { status: 400 });
    if (!dados.nome) return NextResponse.json({ error: 'Informe o nome do condomínio.' }, { status: 400 });
    // Nome pode repetir (há "Panorama" em bairros diferentes); CNPJ não.
    if (dados.cnpj) {
      const outro = (await Database.getCondominios()).find((c) => c.cnpj === dados.cnpj);
      if (outro) return NextResponse.json({ error: `CNPJ já cadastrado em "${outro.nome}".` }, { status: 409 });
    }
    const limpo = Object.fromEntries(Object.entries(dados).filter(([, v]) => v !== null));
    const condominio = await Database.createCondominio(limpo);
    return NextResponse.json({ success: true, condominio });
  } catch (e) {
    console.error('Erro ao criar condomínio:', e);
    return NextResponse.json({ error: 'Erro interno.' }, { status: 500 });
  }
}
