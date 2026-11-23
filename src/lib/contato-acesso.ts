// Quem pode cadastrar/editar contato do condomínio em campo (22/11). Regra
// pura, sem I/O. O técnico mexe nos contatos dos condomínios das OS que estão
// atribuídas a ele: abertas, ou finalizadas nos últimos 30 dias. Gestor e
// secretária seguem com tudo (podeEditarContato em src/lib/roles.ts).
import type { Contato, OS } from './db';

export const DIAS_CONTATO_APOS_FINALIZAR = 30;

/** Papéis que o técnico pode escolher no contato (o gestor tem a lista toda). */
export const PAPEIS_CONTATO_TECNICO: Contato['papel'][] = ['zelador', 'gerente', 'portaria', 'sindico'];

export const ROTULO_PAPEL_CONTATO: Record<Contato['papel'], string> = {
  zelador: 'Zelador',
  gerente: 'Gerente',
  portaria: 'Portaria',
  sindico: 'Síndico',
  administradora: 'Administradora',
  conservadora: 'Conservadora',
  plantao: 'Plantão',
};

// Nível de escalonamento de um contato novo cadastrado pelo técnico: quem está
// no local primeiro, depois quem responde pelo condomínio. O técnico não
// escolhe nem muda o nível — quem ajusta a cadeia é o escritório.
export function nivelPadraoDoPapel(papel: Contato['papel']): 1 | 2 | 3 {
  return papel === 'zelador' || papel === 'portaria' ? 1 : 2;
}

type OSDoTecnico = Pick<OS, 'tecnico_id' | 'status'> & Partial<Pick<OS, 'saida_em'>>;

export function tecnicoAtendeCondominio(tecnicoId: string, oss: OSDoTecnico[], agora: number = Date.now()): boolean {
  const corte = agora - DIAS_CONTATO_APOS_FINALIZAR * 86_400_000;
  return oss.some((os) => {
    if (os.tecnico_id !== tecnicoId) return false;
    if (os.status === 'aberta' || os.status === 'em_andamento') return true;
    if (os.status === 'finalizada' && os.saida_em) return new Date(os.saida_em).getTime() >= corte;
    return false;
  });
}
