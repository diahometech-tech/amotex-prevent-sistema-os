// Aplica a reorganização da fila de preventivas (src/lib/reorganizar-fila.ts)
// em todos os técnicos. Servidor: usado pelo botão "Reorganizar agora" (tela
// de Rotas) e pela rotina diária das 5h (n8n).
import { Database } from './db';
import { hojeISO } from './os-agenda';
import { lerMetaVisitas } from './meta-visitas';
import { preventivaAberta, reorganizarFila, type MovimentoFila, type OpcoesFila } from './reorganizar-fila';

export interface MovimentoDetalhado extends MovimentoFila {
  condominio_nome: string;
  tecnico_id: string;
  tecnico_nome: string;
}

export async function calcularReorganizacao(hoje: string = hojeISO(), opcoes: OpcoesFila = {}): Promise<{ meta: number; movimentos: MovimentoDetalhado[] }> {
  const [oss, condominios, users, meta] = await Promise.all([
    Database.getOSs(), Database.getCondominios(), Database.getUsers(), lerMetaVisitas(),
  ]);
  const nomeCondominio = new Map(condominios.map((c) => [c.id, c.nome]));
  const nomeTecnico = new Map(users.map((u) => [u.id, u.nome]));
  const porId = new Map(oss.map((o) => [o.id, o]));
  // Só técnicos que têm preventiva aberta.
  const tecnicos = [...new Set(oss.filter(preventivaAberta).map((o) => o.tecnico_id).filter((t): t is string => !!t))];

  const movimentos: MovimentoDetalhado[] = [];
  for (const t of tecnicos) {
    for (const m of reorganizarFila(oss, t, hoje, meta, undefined, opcoes)) {
      const os = porId.get(m.os_id)!;
      movimentos.push({
        ...m,
        condominio_nome: nomeCondominio.get(os.condominio_id) ?? '',
        tecnico_id: t,
        tecnico_nome: nomeTecnico.get(t) ?? '',
      });
    }
  }
  movimentos.sort((a, b) => a.para.localeCompare(b.para) || a.tecnico_nome.localeCompare(b.tecnico_nome, 'pt-BR'));
  return { meta, movimentos };
}

/** Calcula e grava. Um audit log por OS remarcada. Idempotente. */
export async function aplicarReorganizacao(
  ator: string,
  hoje: string = hojeISO(),
  opcoes: OpcoesFila = {}
): Promise<{ meta: number; movimentos: MovimentoDetalhado[] }> {
  const resultado = await calcularReorganizacao(hoje, opcoes);
  const aplicados: MovimentoDetalhado[] = [];
  for (const m of resultado.movimentos) {
    // Confere de novo: nesse intervalo o técnico pode ter registrado a chegada
    // ou o escritório mudado a data. Quem não bate fica como está.
    const atual = await Database.getOSById(m.os_id);
    if (!atual || !preventivaAberta(atual) || atual.data_programada !== m.de) continue;
    await Database.updateOS(m.os_id, { data_programada: m.para });
    await Database.createAuditLog({
      entidade: 'os', entidade_id: m.os_id, acao: 'REAGENDADA_AUTOMATICA', ator,
      detalhe: { de: m.de, para: m.para, tecnico_id: m.tecnico_id, meta: resultado.meta },
    });
    aplicados.push(m);
  }
  return { meta: resultado.meta, movimentos: aplicados };
}
