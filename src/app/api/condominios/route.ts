import { NextRequest, NextResponse } from 'next/server';
import { Database } from '@/lib/db';
import { condominioParaPapel, filtrarOSVisiveis, getSessionFromRequest, isScopedToOwnCondominio } from '@/lib/auth';
import { isEscritorio, podeEditarCondominio } from '@/lib/roles';
import { validarCadastro } from '@/lib/financeiro/cadastro';

// GET /api/condominios — lista condomínios. Escritório vê todos; síndico só o
// próprio; técnico só os das OS que ele vê (calculado em lote: uma leitura de
// OS, não uma consulta por condomínio). Campos de contrato só pro escritório.
export async function GET(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: 'Sessão expirada.' }, { status: 401 });

  const all = await Database.getCondominios();
  let visiveis = all;
  if (isScopedToOwnCondominio(session.role)) {
    const user = await Database.getUserById(session.id);
    visiveis = all.filter((c) => c.id === user?.condominio_id);
  } else if (!isEscritorio(session.role)) {
    if (session.role !== 'tecnico') return NextResponse.json({ error: 'Acesso negado.' }, { status: 403 });
    const oss = await filtrarOSVisiveis(session, await Database.getOSs());
    const ids = new Set(oss.map((o) => o.condominio_id));
    visiveis = all.filter((c) => ids.has(c.id));
  }
  return NextResponse.json({ condominios: visiveis.map((c) => condominioParaPapel(session.role, c)) });
}

// POST /api/condominios — cria condomínio. Só admin.
export async function POST(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session || !podeEditarCondominio(session.role)) {
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
