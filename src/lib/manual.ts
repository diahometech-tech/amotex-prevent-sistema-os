// Manual de uso por papel. O conteúdo fica em manual.json — fonte única usada
// pela tela /ajuda e pelo gerador dos manuais em DOCX (fora do repo), pra
// tela e documento nunca dizerem coisas diferentes. Ao mudar um fluxo, mude
// o JSON junto.
import type { UserRole } from './db';
import conteudo from './manual.json';

export interface SecaoManual {
  titulo: string;
  passos: string[];
}

export interface SituacaoManual {
  pergunta: string;
  resposta: string;
}

export interface ManualPapel {
  papel: UserRole;
  titulo: string;
  resumo: string;
  secoes: SecaoManual[];
  situacoes: SituacaoManual[];
}

export const MANUAL_ATUALIZADO: string = conteudo.atualizado;
const PAPEIS = conteudo.papeis as ManualPapel[];

// Regra de visibilidade (Amotex, 18/11): cada perfil vê só o que é dele; o
// gestor vê tudo — inclusive o manual dos outros papéis, pra treinar a equipe.
export function manuaisVisiveis(role: UserRole): ManualPapel[] {
  if (role === 'admin') return PAPEIS;
  return PAPEIS.filter((m) => m.papel === role);
}
