// Roteiro padrão de checklist por tipo de OS — o que todo atendimento da
// Amotex verifica, independente dos equipamentos cadastrados. Antes disto, o
// checklist saía só dos equipamentos do condomínio: um condomínio sem
// equipamento cadastrado gerava OS de checklist vazio, finalizável sem fazer
// nada. Os itens por equipamento continuam sendo acrescentados depois deste
// roteiro (ver POST /api/os).
//
// Texto editável — ajustar aqui conforme o procedimento da equipe técnica
// (vale pras OS criadas DEPOIS da mudança; as já abertas mantêm o que têm).
import type { OsTipo } from './db';

export interface ItemChecklistPadrao {
  descricao: string;
  obrigatorio: boolean;
}

export const CHECKLIST_PADRAO: Record<OsTipo, ItemChecklistPadrao[]> = {
  preventiva: [
    { descricao: 'Bombas: partida, ruído e vibração normais', obrigatorio: true },
    { descricao: 'Revezamento/alternância entre as bombas funcionando', obrigatorio: true },
    { descricao: 'Sem vazamento em selo mecânico, registros e conexões', obrigatorio: true },
    { descricao: 'Quadro de comando: contatores, relés e disjuntores', obrigatorio: true },
    { descricao: 'Corrente dos motores medida (anotar na observação se fora do normal)', obrigatorio: true },
    { descricao: 'Boias / automático de nível da cisterna e da caixa superior', obrigatorio: true },
    { descricao: 'Caixas d\'água: nível, tampas fechadas e extravasor livre', obrigatorio: true },
    { descricao: 'Casa de bombas limpa e organizada ao sair', obrigatorio: false },
  ],
  corretiva: [
    { descricao: 'Problema relatado conferido no local', obrigatorio: true },
    { descricao: 'Causa identificada (descrever na observação)', obrigatorio: true },
    { descricao: 'Reparo executado', obrigatorio: true },
    { descricao: 'Teste de funcionamento após o reparo', obrigatorio: true },
    { descricao: 'Zelador orientado sobre o ocorrido', obrigatorio: false },
  ],
};
