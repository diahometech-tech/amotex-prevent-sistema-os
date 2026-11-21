// Trava de qualidade da finalização de OS (PRD — Must): checklist
// obrigatório concluído, registro fotográfico antes/depois e assinatura do
// técnico e do zelador. Foto só é exigida na CORRETIVA (decisão do Dm em
// 20/11: "as fotos não são necessárias na preventiva, na corretiva precisa do
// antes e depois"). Na corretiva de um equipamento (os.equipamento_id), as
// duas fotos são daquele equipamento; nas demais, uma antes e uma depois
// quaisquer. Na preventiva a foto é opcional. Função pura, sem I/O — usada tanto pelo backend
// (Database.finalizarOS, que é a barreira real) quanto pela tela (OSModal,
// pra travar o botão e listar o que falta). Uma fonte só, pra servidor e
// tela não divergirem — mesma lição de os-priority.ts.
import type { ChecklistItem, Foto, OS } from './db';

/** Nome curto do equipamento a partir do item do checklist ("Inspecionar X (...)" → "X (...)"). */
export function nomeEquipamentoDoItem(descricao: string): string {
  return descricao.replace(/^Inspecionar\s+/i, '');
}

/**
 * Equipamentos que exigem foto ANTES e DEPOIS nesta OS. Só a corretiva de um
 * equipamento (os.equipamento_id, se estiver no checklist) tem; a preventiva
 * não exige foto nenhuma (20/11) e os demais itens "Inspecionar X" da
 * corretiva também não travam a finalização.
 */
export function equipamentosObrigatorios<T extends Pick<ChecklistItem, 'equipamento_id'>>(
  os: Pick<OS, 'tipo'> & { equipamento_id?: string },
  checklist: T[]
): (T & { equipamento_id: string })[] {
  const vistos = new Set<string>();
  const itens: (T & { equipamento_id: string })[] = [];
  if (os.tipo !== 'corretiva') return itens;
  for (const item of checklist) {
    if (!item.equipamento_id || vistos.has(item.equipamento_id)) continue;
    if (item.equipamento_id !== os.equipamento_id) continue;
    vistos.add(item.equipamento_id);
    itens.push(item as T & { equipamento_id: string });
  }
  return itens;
}

/** "Bomba 1, Bomba 2, Bomba 3 e mais 2" — lista curta pra mensagem. */
function listaCurta(nomes: string[]): string {
  const vistos = nomes.slice(0, 3).join(', ');
  return nomes.length > 3 ? `${vistos} e mais ${nomes.length - 3}` : vistos;
}

export function pendenciasFinalizacao({
  os,
  checklist,
  fotos,
}: {
  os: Pick<OS, 'tipo' | 'assinatura_tecnico_url' | 'assinatura_zelador_url' | 'assinatura_zelador_nome'> & { equipamento_id?: string };
  checklist: Pick<ChecklistItem, 'obrigatorio' | 'concluido' | 'equipamento_id' | 'descricao'>[];
  fotos: Pick<Foto, 'momento' | 'equipamento_id'>[];
}): string[] {
  const pendencias: string[] = [];
  const itensPendentes = checklist.filter((i) => i.obrigatorio && !i.concluido).length;
  if (itensPendentes > 0) {
    pendencias.push(`${itensPendentes} item(ns) obrigatório(s) do checklist pendente(s)`);
  }
  const obrigatorios = equipamentosObrigatorios(os, checklist);
  if (obrigatorios.length > 0) {
    // Com equipamento obrigatório, cada um precisa das duas fotos; as fotos
    // gerais viram opcionais (a evidência é por equipamento).
    for (const [momento, rotulo] of [['antes', 'ANTES'], ['depois', 'DEPOIS']] as const) {
      const tem = new Set(fotos.filter((f) => f.momento === momento && f.equipamento_id).map((f) => f.equipamento_id));
      const faltam = obrigatorios.filter((i) => !tem.has(i.equipamento_id));
      if (faltam.length > 0) {
        pendencias.push(`Falta foto ${rotulo} de: ${listaCurta(faltam.map((i) => nomeEquipamentoDoItem(i.descricao)))}`);
      }
    }
  } else if (os.tipo === 'corretiva') {
    // Corretiva sem equipamento obrigatório: uma foto antes e uma depois, geral ou de equipamento.
    // Preventiva não exige foto (20/11).
    if (!fotos.some((f) => f.momento === 'antes')) pendencias.push('Falta foto ANTES do serviço');
    if (!fotos.some((f) => f.momento === 'depois')) pendencias.push('Falta foto DEPOIS do serviço');
  }
  if (!os.assinatura_tecnico_url) pendencias.push('Falta assinatura do técnico');
  if (!os.assinatura_zelador_url) pendencias.push('Falta assinatura do zelador');
  // Só roda na finalização: OS já finalizadas antes do nome existir não são afetadas.
  else if (!os.assinatura_zelador_nome?.trim()) pendencias.push('Falta o nome de quem assinou pelo condomínio');
  return pendencias;
}
