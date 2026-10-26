// Meta de carteira (ex.: "200 condomínios até o fim do ano" — reunião de
// 26/10). Guardada na tabela configuracao. Servidor.
import { Database } from '../db';
import { hojeISO } from '../os-agenda';

export async function lerMeta(): Promise<{ meta: number; prazo: string }> {
  const [meta, prazo] = await Promise.all([Database.getConfiguracao('meta_condominios'), Database.getConfiguracao('meta_prazo')]);
  return {
    meta: meta && Number(meta) > 0 ? Number(meta) : 200,
    prazo: prazo && /^\d{4}-\d{2}$/.test(prazo) ? prazo : `${hojeISO().slice(0, 4)}-12`,
  };
}
