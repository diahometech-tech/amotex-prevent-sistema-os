// Trava de qualidade da finalização de OS (PRD — Must): checklist
// obrigatório concluído, registro fotográfico antes/depois e assinatura do
// técnico e do zelador. Função pura, sem I/O — usada tanto pelo backend
// (Database.finalizarOS, que é a barreira real) quanto pela tela (OSModal,
// pra travar o botão e listar o que falta). Uma fonte só, pra servidor e
// tela não divergirem — mesma lição de os-priority.ts.
import type { ChecklistItem, Foto, OS } from './db';

export function pendenciasFinalizacao({
  os,
  checklist,
  fotos,
}: {
  os: Pick<OS, 'assinatura_tecnico_url' | 'assinatura_zelador_url'>;
  checklist: Pick<ChecklistItem, 'obrigatorio' | 'concluido'>[];
  fotos: Pick<Foto, 'momento'>[];
}): string[] {
  const pendencias: string[] = [];
  const itensPendentes = checklist.filter((i) => i.obrigatorio && !i.concluido).length;
  if (itensPendentes > 0) {
    pendencias.push(`${itensPendentes} item(ns) obrigatório(s) do checklist pendente(s)`);
  }
  if (!fotos.some((f) => f.momento === 'antes')) pendencias.push('Falta foto ANTES do serviço');
  if (!fotos.some((f) => f.momento === 'depois')) pendencias.push('Falta foto DEPOIS do serviço');
  if (!os.assinatura_tecnico_url) pendencias.push('Falta assinatura do técnico');
  if (!os.assinatura_zelador_url) pendencias.push('Falta assinatura do zelador');
  return pendencias;
}
