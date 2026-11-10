// Catálogo padrão de bombas e motores em condomínios — lista de referência da
// própria Amotex ("Bombas e Motores em Condomínios", enviada em 09/11), usada
// no cadastro do parque de máquinas de cada condomínio (e, mais à frente, na
// vistoria/proposta). É referência de inventário: não indica cobertura de
// contrato. A lista é fixa no código; um tipo fora dela entra como "Outro"
// com o nome digitado.
export interface CategoriaEquipamento {
  id: string;
  nome: string;
  tipos: string[];
}

export const CATEGORIAS_EQUIPAMENTO: CategoriaEquipamento[] = [
  {
    id: 'agua',
    nome: 'Abastecimento e distribuição de água',
    tipos: [
      'Bomba de recalque de água potável',
      'Bomba de pressurização da rede hidráulica',
      'Bomba de transferência entre reservatórios',
      'Bomba de pressurização de água quente',
      'Bomba de recirculação de água quente',
    ],
  },
  {
    id: 'esgoto',
    nome: 'Esgoto e drenagem',
    tipos: [
      'Bomba submersível de esgoto',
      'Bomba submersível de águas pluviais',
      'Bomba de drenagem de garagem e subsolo',
      'Bomba de drenagem de poço de elevador',
      'Bomba de recalque de água de reúso',
      'Bomba de drenagem de lençol freático',
    ],
  },
  {
    id: 'incendio',
    nome: 'Combate a incêndio',
    tipos: [
      'Bomba principal de incêndio',
      'Bomba reserva de incêndio',
      'Bomba jockey (manutenção da pressão)',
      'Bomba de sistema de sprinklers',
    ],
  },
  {
    id: 'lazer',
    nome: 'Piscinas e áreas de lazer',
    tipos: [
      'Bomba de filtragem de piscina adulta',
      'Bomba de filtragem de piscina infantil',
      'Bomba de circulação de aquecimento de piscina',
      'Bomba de hidromassagem',
      'Bomba de cascata',
      'Bomba de fonte ou chafariz',
      'Bomba de circulação/filtragem de espelho d’água',
    ],
  },
  {
    id: 'irrigacao',
    nome: 'Irrigação e outros sistemas',
    tipos: [
      'Bomba de irrigação de jardim',
      'Bomba de captação/aproveitamento de água da chuva',
      'Bomba de pressurização para irrigação',
      'Bomba de lago ornamental',
    ],
  },
  {
    id: 'exaustao',
    nome: 'Exaustão e ventilação',
    tipos: [
      'Motor de pressurização de escada de emergência',
      'Motor de exaustão de escada',
      'Motor de exaustão de garagem',
      'Motor de insuflamento de ar em garagem',
      'Motor de exaustão de casa de máquinas',
      'Motor de ventilação de área técnica ou comum',
    ],
  },
  {
    id: 'chiller',
    nome: 'Chiller e sistemas de água gelada',
    tipos: [
      'Bomba de água gelada — circuito primário',
      'Bomba de água gelada — circuito secundário',
      'Bomba de água de condensação',
      'Bomba de circulação de solução glicolada',
      'Motor elétrico de compressor de chiller',
      'Motor de bomba do circuito de água gelada',
      'Motor de bomba do circuito de condensação',
      'Motor de ventilador de condensador a ar',
    ],
  },
  {
    id: 'climatizacao',
    nome: 'Torres de resfriamento e climatização',
    tipos: [
      'Motor de ventilador de torre condensadora',
      'Bomba de reposição de água de torre',
      'Bomba de purga/drenagem de torre',
      'Motor de ventilador de fancoil',
      'Motor de ventilador de unidade de tratamento de ar (UTA)',
      'Bomba de drenagem de condensado de ar-condicionado',
    ],
  },
];

export const CATEGORIA_OUTRO = 'outro';

const POR_ID = new Map(CATEGORIAS_EQUIPAMENTO.map((c) => [c.id, c]));

export function nomeCategoria(id?: string | null): string {
  if (!id) return 'Sem categoria';
  if (id === CATEGORIA_OUTRO) return 'Outro';
  return POR_ID.get(id)?.nome ?? 'Sem categoria';
}

export function categoriaValida(id: unknown): id is string {
  return typeof id === 'string' && (id === CATEGORIA_OUTRO || POR_ID.has(id));
}

/** Categoria de um tipo do catálogo (pelo nome exato), ou undefined. */
export function categoriaDoTipo(tipo: string): string | undefined {
  return CATEGORIAS_EQUIPAMENTO.find((c) => c.tipos.includes(tipo))?.id;
}
