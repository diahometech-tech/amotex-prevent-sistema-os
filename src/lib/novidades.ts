// "Novidades" do sistema: avisos curtos de o que mudou, mostrados no topo da
// tela inicial até a pessoa tocar em "Entendi" e guardados na Ajuda. A lista é
// versionada no código (mais simples que um cadastro); só o "quem já leu" vai
// pro banco (tabela novidade_lida). Para publicar uma novidade, acrescente um
// item aqui com id novo e único; para trocar o texto de uma já publicada sem
// reaparecer pra quem leu, mantenha o id.
import type { UserRole } from './db';

export interface Novidade {
  id: string;
  data: string; // YYYY-MM-DD
  titulo: string;
  itens: string[];
  perfis: UserRole[];
}

export const TODOS_OS_PERFIS: UserRole[] = ['admin', 'secretaria', 'tecnico', 'sindico'];

export const NOVIDADES: Novidade[] = [
  {
    id: '2026-11-25-tecnico-todas-as-os',
    data: '2026-11-25',
    titulo: 'Agora você vê todas as OS',
    itens: [
      'A tela de OS mostra as OS de todos os técnicos. Use os filtros Todas, Minhas e Sem técnico.',
      'Para fazer uma OS, abra e toque em "Assumir esta OS". Se ela estiver com outro técnico e ainda não tiver começado, o sistema pede confirmação e avisa o colega.',
      'OS que outro técnico já começou (a caminho ou em andamento) ficam só para consulta.',
      'Em qualquer condomínio você pode cadastrar o parque de máquinas (equipamentos) e os contatos de quem acompanha a visita no local.',
      'O sistema e o PDF da OS agora usam a logo da Amotex.',
    ],
    perfis: ['tecnico'],
  },
  {
    id: '2026-11-25-escritorio-tecnicos-e-logo',
    data: '2026-11-25',
    titulo: 'Técnicos veem todas as OS e logo nova',
    itens: [
      'Todos os técnicos veem todas as OS e podem assumir: as sem técnico, direto; as de outro técnico, só se ainda não começaram, e o técnico anterior recebe um aviso.',
      'A troca fica registrada no histórico da OS ("Fulano assumiu a OS (estava com Ciclano)").',
      'Checklist, fotos e finalizar continuam só com o técnico responsável pela OS.',
      'Os técnicos podem cadastrar equipamentos e contatos em qualquer condomínio. Os dados de contrato continuam escondidos deles.',
      'A logo da Amotex está no menu, no login, no ícone do app e no PDF da OS. Quem já instalou o app pode precisar removê-lo e instalar de novo para ver o ícone novo.',
      'Os alertas de sensor agora dizem quando só o condomínio não foi identificado.',
    ],
    perfis: ['admin', 'secretaria'],
  },
  {
    id: '2026-11-25-sindico-logo',
    data: '2026-11-25',
    titulo: 'Logo nova',
    itens: ['O sistema e o PDF da OS agora usam a logo da Amotex.'],
    perfis: ['sindico'],
  },
];

// Novidades do perfil, da mais recente para a mais antiga. `lista` existe só
// para teste; o app usa a lista do código.
export function novidadesPara(role: UserRole, lista: Novidade[] = NOVIDADES): Novidade[] {
  return lista
    .filter((n) => n.perfis.includes(role))
    .sort((a, b) => (a.data === b.data ? b.id.localeCompare(a.id) : b.data.localeCompare(a.data)));
}

export function novidadePara(role: UserRole, id: string): Novidade | null {
  return novidadesPara(role).find((n) => n.id === id) ?? null;
}
