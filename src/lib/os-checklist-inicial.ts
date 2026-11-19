// Checklist inicial de uma OS recém-criada: roteiro padrão do tipo
// (src/lib/checklist-padrao.ts) + um item por equipamento cadastrado no
// condomínio. Usado por POST /api/os e pelo planejamento mensal das
// preventivas — uma fonte só pro que toda OS nasce com. O técnico ainda pode
// acrescentar itens na hora — o roteiro é guiado, não travado.
import { Database, type ChecklistItem, type Equipamento, type OS } from './db';
import { CHECKLIST_PADRAO } from './checklist-padrao';

export async function criarChecklistInicial(os: Pick<OS, 'id' | 'tipo' | 'condominio_id'>): Promise<void> {
  for (const item of CHECKLIST_PADRAO[os.tipo]) {
    await Database.createChecklistItem({ os_id: os.id, descricao: item.descricao, obrigatorio: item.obrigatorio });
  }
  const equipamentos = await Database.getEquipamentosByCondominio(os.condominio_id);
  for (const eq of equipamentos) {
    await Database.createChecklistItem(itemDeEquipamento(os, eq));
  }
}

// Item "Inspecionar …" de um equipamento. Fonte única do formato: usado na
// criação da OS e quando o técnico cadastra um equipamento novo dentro da OS
// (1ª vistoria), pro item novo ficar idêntico aos que a OS já nasce com.
export function itemDeEquipamento(
  os: Pick<OS, 'id' | 'tipo'>,
  eq: Pick<Equipamento, 'id' | 'tipo' | 'identificacao' | 'modelo'>
): Pick<ChecklistItem, 'os_id' | 'equipamento_id' | 'descricao' | 'obrigatorio'> {
  const detalhe = [eq.identificacao, eq.modelo].filter(Boolean).join(' · ');
  return {
    os_id: os.id,
    equipamento_id: eq.id,
    // Identificação primeiro: com várias bombas iguais no prédio, é ela que
    // diz ao técnico qual é qual.
    descricao: `Inspecionar ${eq.tipo}${detalhe ? ` (${detalhe})` : ''}`,
    // Na corretiva o foco é o defeito chamado — inspecionar cada
    // equipamento do prédio fica como item opcional, não trava o fechamento.
    obrigatorio: os.tipo === 'preventiva',
  };
}
