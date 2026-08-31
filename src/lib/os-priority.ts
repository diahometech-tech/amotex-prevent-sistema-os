// Prioridade visual da lista de OS — função pura, sem I/O (mesmo espírito de
// src/lib/sla.ts no NexusFlow original, adaptado ao domínio de OS de
// condomínio).
//
// Base = os.prioridade (valor manual, definido na criação e editável depois
// por admin/técnico — 3 níveis: alta/media/baixa). tipo/origem/tempo em
// aberto entram só como AGRAVANTE por cima da base, pra escalar a exibição
// (nunca rebaixar abaixo do que foi registrado manualmente): uma OS marcada
// "baixa" só sobe na tela se for corretiva, automática do Hermes, ou estourar
// o tempo em aberto — nunca desce de "baixa" por conta do tipo/tempo.
// "urgente" é só alcançável por agravante (nunca base manual direta) — é o
// 4º nível da escala visual, sem equivalente direto no campo manual de 3.
import type { OS } from './db';

export type OsPrioridade = 'urgente' | 'alta' | 'normal' | 'baixa';

const NIVEL_ORDEM: OsPrioridade[] = ['baixa', 'normal', 'alta', 'urgente'];

function maiorNivel(a: OsPrioridade, b: OsPrioridade): OsPrioridade {
  return NIVEL_ORDEM.indexOf(a) >= NIVEL_ORDEM.indexOf(b) ? a : b;
}

function nivelBase(prioridade: OS['prioridade']): OsPrioridade {
  if (prioridade === 'alta') return 'alta';
  if (prioridade === 'baixa') return 'baixa';
  return 'normal'; // media
}

const NIVEL_META: Record<OsPrioridade, { label: string; tone: OsPrioridadeInfo['tone'] }> = {
  urgente: { label: 'Urgente', tone: 'red' },
  alta: { label: 'Alta', tone: 'warning' },
  normal: { label: 'Normal', tone: 'info' },
  baixa: { label: 'Baixa', tone: 'neutral' },
};

const URGENTE_CORRETIVA_HORAS = 4;
const ALTA_PREVENTIVA_HORAS = 48;

export interface OsPrioridadeInfo {
  nivel: OsPrioridade;
  label: string;
  /** Tom para os componentes Badge/indicador (ver src/components/ui/Badge.tsx) */
  tone: 'red' | 'warning' | 'info' | 'neutral';
  elapsedHours: number;
  elapsedLabel: string;
}

function fmtDuration(hours: number): string {
  const h = Math.floor(hours);
  if (h <= 0) return '<1h';
  if (h < 24) return `${h}h`;
  const days = Math.floor(h / 24);
  const rest = h % 24;
  return rest > 0 ? `${days}d ${rest}h` : `${days}d`;
}

export function computeOsPrioridade(
  os: Pick<OS, 'tipo' | 'origem' | 'status' | 'criado_em' | 'prioridade'>
): OsPrioridadeInfo {
  const now = Date.now();
  const criado = os.criado_em ? new Date(os.criado_em).getTime() : now;
  const elapsedHours = Math.max(0, (now - criado) / 3_600_000);
  const elapsedLabel = fmtDuration(elapsedHours);

  if (os.status === 'finalizada' || os.status === 'cancelada') {
    return { nivel: 'baixa', label: 'Encerrada', tone: 'neutral', elapsedHours, elapsedLabel };
  }

  let nivel = nivelBase(os.prioridade);

  // Agravantes: cada regra só escala pra cima a partir da prioridade manual,
  // nunca rebaixa. `origem` é agravante DENTRO de corretiva, não isolado — uma
  // preventiva aberta pelo Hermes não é urgente só por ser automática.
  if (os.tipo === 'corretiva') {
    const urgente = os.origem === 'hermes_automatica' || elapsedHours >= URGENTE_CORRETIVA_HORAS;
    nivel = maiorNivel(nivel, urgente ? 'urgente' : 'alta');
  } else if (elapsedHours >= ALTA_PREVENTIVA_HORAS) {
    nivel = maiorNivel(nivel, 'alta');
  }

  const meta = NIVEL_META[nivel];
  return { nivel, label: meta.label, tone: meta.tone, elapsedHours, elapsedLabel };
}

const NIVEL_PESO: Record<OsPrioridade, number> = { urgente: 0, alta: 1, normal: 2, baixa: 3 };

// Comparador da lista de OS: mais urgente primeiro; dentro do mesmo nível, a
// mais antiga primeiro (quem está esperando há mais tempo sobe).
export function compararPorPrioridade(a: OS, b: OS): number {
  const pa = computeOsPrioridade(a);
  const pb = computeOsPrioridade(b);
  const diff = NIVEL_PESO[pa.nivel] - NIVEL_PESO[pb.nivel];
  return diff !== 0 ? diff : pb.elapsedHours - pa.elapsedHours;
}

export interface RotaCondominio {
  condominio_id: string;
  total: number;
  /** OS no nível visual "urgente" — mesma escala dos badges da tela. */
  urgentes: number;
  /** OS no nível visual "alta". */
  altas: number;
  /** OS ativas do condomínio, já ordenadas por prioridade. */
  oss: OS[];
}

// Agrupa as OS ATIVAS por condomínio para a tela de Gestão de Rotas e o card
// "Rota do Dia" do dashboard.
//
// Existe apesar de computeResumoRotas em src/lib/sla.ts porque aquele conta
// urgentes por `os.prioridade === 'alta'` (o campo manual cru, de 3 níveis),
// enquanto os badges da tela usam computeOsPrioridade (a escala visual de 4
// níveis, que escala por tipo/origem/tempo em aberto). Uma corretiva
// automática do Hermes com prioridade manual "media" aparecia com badge
// "Urgente" e o card do condomínio dizia "0 urgentes" — e o sort chegava a
// empurrar o condomínio mais crítico para baixo. Aqui a contagem e a ordem
// saem da MESMA função que pinta o badge, então não há como divergirem.
export function resumoRotasPorCondominio(oss: OS[]): RotaCondominio[] {
  const porCondominio = new Map<string, OS[]>();
  for (const os of oss) {
    if (os.status === 'finalizada' || os.status === 'cancelada') continue;
    const lista = porCondominio.get(os.condominio_id) || [];
    lista.push(os);
    porCondominio.set(os.condominio_id, lista);
  }

  return Array.from(porCondominio.entries())
    .map(([condominio_id, lista]) => {
      const niveis = lista.map((os) => computeOsPrioridade(os).nivel);
      return {
        condominio_id,
        total: lista.length,
        urgentes: niveis.filter((n) => n === 'urgente').length,
        altas: niveis.filter((n) => n === 'alta').length,
        oss: [...lista].sort(compararPorPrioridade),
      };
    })
    .sort((a, b) => b.urgentes - a.urgentes || b.altas - a.altas || b.total - a.total);
}

export const OS_TIPO_LABELS: Record<OS['tipo'], string> = {
  preventiva: 'Preventiva',
  corretiva: 'Corretiva',
};

export const OS_STATUS_LABELS: Record<OS['status'], string> = {
  aberta: 'Aberta',
  em_andamento: 'Em andamento',
  finalizada: 'Finalizada',
  cancelada: 'Cancelada',
};
