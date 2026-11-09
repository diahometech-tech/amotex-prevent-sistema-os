// Checklist inicial de uma OS recém-criada: roteiro padrão do tipo
// (src/lib/checklist-padrao.ts) + um item por equipamento cadastrado no
// condomínio. Usado por POST /api/os e pelo planejamento mensal das
// preventivas — uma fonte só pro que toda OS nasce com. O técnico ainda pode
// acrescentar itens na hora — o roteiro é guiado, não travado.
import { Database, type OS } from './db';
import { CHECKLIST_PADRAO } from './checklist-padrao';

export async function criarChecklistInicial(os: Pick<OS, 'id' | 'tipo' | 'condominio_id'>): Promise<void> {
  for (const item of CHECKLIST_PADRAO[os.tipo]) {
    await Database.createChecklistItem({ os_id: os.id, descricao: item.descricao, obrigatorio: item.obrigatorio });
  }
  const equipamentos = await Database.getEquipamentosByCondominio(os.condominio_id);
  for (const eq of equipamentos) {
    await Database.createChecklistItem({
      os_id: os.id,
      equipamento_id: eq.id,
      descricao: `Inspecionar ${eq.tipo}${eq.modelo ? ` (${eq.modelo})` : ''}`,
      // Na corretiva o foco é o defeito chamado — inspecionar cada
      // equipamento do prédio fica como item opcional, não trava o fechamento.
      obrigatorio: os.tipo === 'preventiva',
    });
  }
}
