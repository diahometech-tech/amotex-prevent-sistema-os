import { NextRequest, NextResponse } from 'next/server';
import { Database } from '@/lib/db';
import { getSessionFromRequest } from '@/lib/auth';
import { chaveNome, MAX_LINHAS_IMPORTACAO, validarLinha } from '@/lib/importacao-condominios';

// POST /api/condominios/importar — cadastro em lote a partir da planilha.
// Só admin (mesma regra do POST /api/condominios). Corpo: { linhas: [...] }
// já lido pela tela (src/lib/importacao-condominios.ts), revalidado aqui com
// as mesmas funções. Condomínio com nome já existente (ou repetido na
// própria planilha) é ignorado, nunca duplicado nem sobrescrito.
// Zelador/síndico com telefone viram contatos de WhatsApp nível 1 e 2 — a
// cadeia de aviso que o Hermes vai usar quando houver sensor.
export async function POST(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session || session.role !== 'admin') {
    return NextResponse.json({ error: 'Apenas administradores podem importar condomínios.' }, { status: 403 });
  }
  try {
    const { linhas } = await request.json();
    if (!Array.isArray(linhas) || linhas.length === 0) {
      return NextResponse.json({ error: 'Nenhuma linha para importar.' }, { status: 400 });
    }
    if (linhas.length > MAX_LINHAS_IMPORTACAO) {
      return NextResponse.json({ error: `Máximo de ${MAX_LINHAS_IMPORTACAO} condomínios por importação.` }, { status: 400 });
    }

    const existentes = new Set((await Database.getCondominios()).map((c) => chaveNome(c.nome)));
    const criados: string[] = [];
    const ignorados: { linha: number; nome?: string; motivo: string }[] = [];
    const avisos: { linha: number; nome: string; motivo: string }[] = [];

    for (const entrada of linhas) {
      const linha = validarLinha(entrada ?? {});
      if ('motivo' in linha) {
        ignorados.push(linha);
        continue;
      }
      const chave = chaveNome(linha.nome);
      if (existentes.has(chave)) {
        ignorados.push({ linha: linha.linha, nome: linha.nome, motivo: 'já cadastrado' });
        continue;
      }
      existentes.add(chave);

      const condominio = await Database.createCondominio({
        nome: linha.nome,
        endereco: linha.endereco,
        administradora: linha.administradora,
        monitoramento_ativo: false,
      });
      criados.push(condominio.nome);

      const contatos = [
        { papel: 'zelador' as const, nivel: 1 as const, nome: linha.zelador_nome, tel: linha.zelador_telefone, rotulo: 'Zelador' },
        { papel: 'sindico' as const, nivel: 2 as const, nome: linha.sindico_nome, tel: linha.sindico_telefone, rotulo: 'Síndico' },
      ];
      for (const c of contatos) {
        if (c.tel) {
          await Database.createContato({
            condominio_id: condominio.id,
            papel: c.papel,
            nome: c.nome || c.rotulo,
            canal_preferencial: 'whatsapp',
            identificador_canal: c.tel,
            nivel_escalonamento: c.nivel,
          });
        } else if (c.nome) {
          avisos.push({ linha: linha.linha, nome: linha.nome, motivo: `${c.rotulo} sem telefone — contato não criado` });
        }
      }
    }

    await Database.createAuditLog({
      entidade: 'condominio', acao: 'IMPORTACAO_PLANILHA', ator: session.name,
      detalhe: { criados: criados.length, ignorados: ignorados.length },
    });
    return NextResponse.json({ success: true, criados, ignorados, avisos });
  } catch (e) {
    console.error('Erro ao importar condomínios:', e);
    return NextResponse.json({ error: 'Erro interno.' }, { status: 500 });
  }
}
