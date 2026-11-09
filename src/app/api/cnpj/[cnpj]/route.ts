import { NextRequest, NextResponse } from 'next/server';
import { Database } from '@/lib/db';
import { getSessionFromRequest } from '@/lib/auth';
import { cnpjValido, limparCnpj, normalizarRespostaCnpj } from '@/lib/financeiro/cnpj';

type RouteContext = { params: Promise<{ cnpj: string }> };

// GET /api/cnpj/[cnpj] — dados públicos da Receita (via BrasilAPI, gratuita e
// sem chave) pra preencher o cadastro do condomínio só com o CNPJ. Admin.
// Também avisa se o CNPJ já está cadastrado. Falha da API externa não trava
// o cadastro: a tela segue com preenchimento manual.
export async function GET(request: NextRequest, context: RouteContext) {
  const session = getSessionFromRequest(request);
  if (!session || session.role !== 'admin') {
    return NextResponse.json({ error: 'Acesso negado.' }, { status: 403 });
  }
  const { cnpj: bruto } = await context.params;
  const cnpj = limparCnpj(bruto);
  if (!cnpjValido(cnpj)) return NextResponse.json({ error: 'CNPJ inválido (confira os números).' }, { status: 400 });

  const existente = (await Database.getCondominios()).find((c) => c.cnpj === cnpj);
  try {
    const res = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`, {
      signal: AbortSignal.timeout(8000),
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
    if (res.status === 404) {
      return NextResponse.json({ error: 'CNPJ não encontrado na Receita.', existente: existente ? { id: existente.id, nome: existente.nome } : null }, { status: 404 });
    }
    if (!res.ok) throw new Error(`BrasilAPI ${res.status}`);
    const dados = normalizarRespostaCnpj(await res.json());
    return NextResponse.json({ dados, existente: existente ? { id: existente.id, nome: existente.nome } : null });
  } catch (e) {
    console.error('Consulta de CNPJ falhou:', e);
    return NextResponse.json(
      { error: 'Não foi possível consultar a Receita agora. Preencha os dados manualmente.', existente: existente ? { id: existente.id, nome: existente.nome } : null },
      { status: 502 }
    );
  }
}
