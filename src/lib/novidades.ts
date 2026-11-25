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
    id: '2026-11-25-logo-e-os-para-todos',
    data: '2026-11-25',
    titulo: 'Novidades de 25/11',
    itens: ['(texto final será colocado depois)'],
    perfis: TODOS_OS_PERFIS,
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
