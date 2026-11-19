// Ligação preventiva → corretiva (pedido 10 da Amotex): durante a
// preventiva o técnico acha um defeito e abre a corretiva já ligada à
// preventiva e ao equipamento. Servidor apenas (usa Database).
import { Database, type Equipamento, type OS } from './db';
import { filtrarOSVisiveis, type SessionUser } from './auth';

export interface VinculosOS {
  /** Corretiva aberta de uma preventiva: a preventiva de origem. */
  origem: Pick<OS, 'id' | 'tipo' | 'status' | 'data_programada' | 'criado_em'> | null;
  /** Preventiva: corretivas abertas a partir dela. */
  corretivas: Pick<OS, 'id' | 'status' | 'descricao_problema' | 'equipamento_id' | 'criado_em'>[];
  /** Equipamento ligado à OS (corretiva aberta da preventiva). */
  equipamento: Pick<Equipamento, 'id' | 'tipo' | 'identificacao' | 'modelo'> | null;
}

// `session` (GET da OS): origem e corretivas ligadas só aparecem se a sessão
// pode ver aquela OS — senão o técnico lia o chamado de OS de outro técnico.
// Sem sessão (PDF), devolve tudo.
export async function vinculosDaOS(os: OS, session?: SessionUser): Promise<VinculosOS> {
  const [doCondominio, equipamentos] = await Promise.all([
    Database.getOSsByCondominio(os.condominio_id),
    os.equipamento_id ? Database.getEquipamentosByCondominio(os.condominio_id) : Promise.resolve([]),
  ]);
  const candidataOrigem = os.os_origem_id ? doCondominio.find((o) => o.id === os.os_origem_id) : undefined;
  const origemOS = candidataOrigem && session ? (await filtrarOSVisiveis(session, [candidataOrigem]))[0] : candidataOrigem;
  const ligadas = doCondominio.filter((o) => o.os_origem_id === os.id);
  const corretivasVisiveis = session ? await filtrarOSVisiveis(session, ligadas) : ligadas;
  const eq = os.equipamento_id ? equipamentos.find((e) => e.id === os.equipamento_id) : undefined;
  return {
    origem: origemOS
      ? {
          id: origemOS.id,
          tipo: origemOS.tipo,
          status: origemOS.status,
          data_programada: origemOS.data_programada,
          criado_em: origemOS.criado_em,
        }
      : null,
    corretivas: corretivasVisiveis
      // criado_em chega como Date do pg e como string do JSON local.
      .sort((a, b) => new Date(a.criado_em).getTime() - new Date(b.criado_em).getTime())
      .map((o) => ({
        id: o.id,
        status: o.status,
        descricao_problema: o.descricao_problema,
        equipamento_id: o.equipamento_id,
        criado_em: o.criado_em,
      })),
    equipamento: eq ? { id: eq.id, tipo: eq.tipo, identificacao: eq.identificacao, modelo: eq.modelo } : null,
  };
}
