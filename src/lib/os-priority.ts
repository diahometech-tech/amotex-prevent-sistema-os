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
