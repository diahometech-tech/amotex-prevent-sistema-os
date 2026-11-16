// Trava de qualidade da finalização de OS (PRD — Must): checklist
// obrigatório concluído, registro fotográfico antes/depois e assinatura do
// técnico e do zelador. Na preventiva, também uma foto de cada equipamento do
// checklist (pedido 8 da Amotex: "se o condomínio tem 5 equipamentos, abre 5
// campos de foto"). Função pura, sem I/O — usada tanto pelo backend
// (Database.finalizarOS, que é a barreira real) quanto pela tela (OSModal,
// pra travar o botão e listar o que falta). Uma fonte só, pra servidor e
// tela não divergirem — mesma lição de os-priority.ts.
import type { ChecklistItem, Foto, OS } from './db';

/** Nome curto do equipamento a partir do item do checklist ("Inspecionar X (...)" → "X (...)"). */
export function nomeEquipamentoDoItem(descricao: string): string {
  return descricao.replace(/^Inspecionar\s+/i, '');
}

/** Itens de equipamento que exigem foto nesta OS (só preventiva; um por equipamento). */
export function itensComFotoObrigatoria<T extends Pick<ChecklistItem, 'equipamento_id'>>(
  os: Pick<OS, 'tipo'>,
  checklist: T[]
): (T & { equipamento_id: string })[] {
  if (os.tipo !== 'preventiva') return [];
  const vistos = new Set<string>();
  const itens: (T & { equipamento_id: string })[] = [];
  for (const item of checklist) {
    if (!item.equipamento_id || vistos.has(item.equipamento_id)) continue;
    vistos.add(item.equipamento_id);
    itens.push(item as T & { equipamento_id: string });
  }
  return itens;
}

export function pendenciasFinalizacao({
  os,
  checklist,
  fotos,
}: {
  os: Pick<OS, 'tipo' | 'assinatura_tecnico_url' | 'assinatura_zelador_url'>;
  checklist: Pick<ChecklistItem, 'obrigatorio' | 'concluido' | 'equipamento_id' | 'descricao'>[];
  fotos: Pick<Foto, 'momento' | 'equipamento_id'>[];
}): string[] {
  const pendencias: string[] = [];
  const itensPendentes = checklist.filter((i) => i.obrigatorio && !i.concluido).length;
  if (itensPendentes > 0) {
    pendencias.push(`${itensPendentes} item(ns) obrigatório(s) do checklist pendente(s)`);
  }
  // Antes/depois gerais: foto de equipamento não conta aqui.
  const gerais = fotos.filter((f) => !f.equipamento_id);
  if (!gerais.some((f) => f.momento === 'antes')) pendencias.push('Falta foto ANTES do serviço');
  if (!gerais.some((f) => f.momento === 'depois')) pendencias.push('Falta foto DEPOIS do serviço');
  const comFoto = new Set(fotos.map((f) => f.equipamento_id).filter(Boolean));
  const semFoto = itensComFotoObrigatoria(os, checklist).filter((i) => !comFoto.has(i.equipamento_id));
  if (semFoto.length > 0) {
    const nomes = semFoto.map((i) => nomeEquipamentoDoItem(i.descricao));
    pendencias.push(
      `Falta foto de ${semFoto.length} equipamento(s): ${nomes.slice(0, 3).join('; ')}${nomes.length > 3 ? '…' : ''}`
    );
  }
  if (!os.assinatura_tecnico_url) pendencias.push('Falta assinatura do técnico');
  if (!os.assinatura_zelador_url) pendencias.push('Falta assinatura do zelador');
  return pendencias;
}
