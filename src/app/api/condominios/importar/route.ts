import { NextRequest, NextResponse } from 'next/server';
import { Database, type Condominio } from '@/lib/db';
import { getSessionFromRequest } from '@/lib/auth';
import { chaveNome, cnpjDaLinha, MAX_LINHAS_IMPORTACAO, validarLinha } from '@/lib/importacao-condominios';

// POST /api/condominios/importar — cadastro em lote a partir da planilha.
// Só admin (mesma regra do POST /api/condominios). Corpo: { linhas: [...] }
// com as linhas BRUTAS da planilha, revalidadas aqui com as mesmas funções
// da prévia (src/lib/importacao-condominios.ts).
//
// - CNPJ já cadastrado → ATUALIZA só as colunas que vieram preenchidas (é
//   como a planilha de levantamento de contratos volta pro sistema).
// - CNPJ desconhecido (ou linha sem CNPJ) → procura pelo nome, e pelo
//   endereço se a linha trouxer um, só entre condomínios ainda SEM CNPJ.
//   Exatamente um → atualiza esse (e grava o CNPJ, se veio). Mais de um →
//   linha recusada (há "Panorama" em bairros diferentes). Nenhum → cria.
//   Sem isso, a planilha de levantamento (que não tem endereço) duplicava
//   condomínio sem CNPJ, e preencher o CNPJ depois criava um segundo.
// - Zelador/síndico com telefone viram contatos de WhatsApp nível 1 e 2 (a
//   cadeia de aviso do Hermes), sem duplicar telefone já cadastrado.

function candidatosPorNome(todos: Condominio[], dados: Partial<Condominio>, linhaTemCnpj: boolean, tocados: Set<string>): Condominio[] {
  const nome = chaveNome(dados.nome ?? '');
  const endereco = dados.endereco ? chaveNome(dados.endereco) : null;
  return todos.filter((c) =>
    chaveNome(c.nome) === nome &&
    (endereco === null || chaveNome(c.endereco ?? '') === endereco) &&
    !(linhaTemCnpj && c.cnpj) &&
    // Duas linhas iguais na mesma planilha são dois condomínios, não um.
    !tocados.has(c.id)
  );
}

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

    const todos = await Database.getCondominios();
    const porCnpj = new Map(todos.filter((c) => c.cnpj).map((c) => [c.cnpj!, c]));
    const tocados = new Set<string>();
    const criados: string[] = [];
    const atualizados: string[] = [];
    const ignorados: { linha: number; nome?: string; motivo: string }[] = [];
    const avisos: { linha: number; nome: string; motivo: string }[] = [];
    const cnpjsNaPlanilha = new Set<string>();

    for (const entrada of linhas) {
      const linha = validarLinha(entrada ?? {});
      if ('motivo' in linha) {
        ignorados.push(linha);
        continue;
      }
      const dados = Object.fromEntries(Object.entries(linha.cadastro).filter(([, v]) => v !== null && v !== undefined)) as Partial<Condominio>;
      const cnpj = cnpjDaLinha(linha);
      if (cnpj && cnpjsNaPlanilha.has(cnpj)) {
        ignorados.push({ linha: linha.linha, nome: dados.nome, motivo: 'CNPJ repetido na planilha' });
        continue;
      }
      if (cnpj) cnpjsNaPlanilha.add(cnpj);

      let condominio: Condominio | null | undefined = cnpj ? porCnpj.get(cnpj) : undefined;
      if (!condominio) {
        if (!dados.nome) {
          ignorados.push({ linha: linha.linha, motivo: 'CNPJ não cadastrado e linha sem nome' });
          continue;
        }
        const candidatos = candidatosPorNome(todos, dados, Boolean(cnpj), tocados);
        if (candidatos.length > 1) {
          ignorados.push({ linha: linha.linha, nome: dados.nome, motivo: 'mais de um condomínio com esse nome — preencha o CNPJ ou o endereço' });
          continue;
        }
        condominio = candidatos[0];
      }

      if (condominio) {
        condominio = await Database.updateCondominio(condominio.id, dados);
        if (!condominio) continue;
        atualizados.push(condominio.nome);
      } else {
        condominio = await Database.createCondominio({ ...dados, monitoramento_ativo: false });
        todos.push(condominio);
        criados.push(condominio.nome);
      }
      tocados.add(condominio.id);
      if (condominio.cnpj) porCnpj.set(condominio.cnpj, condominio);

      const jaTem = new Set((await Database.getContatosByCondominio(condominio.id)).map((c) => c.identificador_canal));
      const contatos = [
        { papel: 'zelador' as const, nivel: 1 as const, nome: linha.zelador_nome, tel: linha.zelador_telefone, rotulo: 'Zelador' },
        { papel: 'sindico' as const, nivel: 2 as const, nome: linha.sindico_nome, tel: linha.sindico_telefone, rotulo: 'Síndico' },
      ];
      for (const c of contatos) {
        if (c.tel && !jaTem.has(c.tel)) {
          await Database.createContato({
            condominio_id: condominio.id,
            papel: c.papel,
            nome: c.nome || c.rotulo,
            canal_preferencial: 'whatsapp',
            identificador_canal: c.tel,
            nivel_escalonamento: c.nivel,
          });
        } else if (c.nome && !c.tel) {
          avisos.push({ linha: linha.linha, nome: condominio.nome, motivo: `${c.rotulo} sem telefone — contato não criado` });
        }
      }
    }

    await Database.createAuditLog({
      entidade: 'condominio', acao: 'IMPORTACAO_PLANILHA', ator: session.name,
      detalhe: { criados: criados.length, atualizados: atualizados.length, ignorados: ignorados.length },
    });
    return NextResponse.json({ success: true, criados, atualizados, ignorados, avisos });
  } catch (e) {
    console.error('Erro ao importar condomínios:', e);
    return NextResponse.json({ error: 'Erro interno.' }, { status: 500 });
  }
}
