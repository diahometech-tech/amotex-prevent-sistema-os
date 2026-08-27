// Prioridade visual da lista de OS — função pura, sem I/O (mesmo espírito de
// src/lib/sla.ts no NexusFlow original, adaptado ao domínio de OS de
// condomínio).
//
// TODO(merge): a OS ganhou um campo `prioridade` manual (alta/media/baixa,
// definido na criação e editável depois por admin/técnico — combinado
// 26/08 com o dono do backend). Esse campo ainda não existe no `OS` deste
// branch, então computeOsPrioridade abaixo ainda deriva tudo de
// tipo+origem+tempo, como antes. Na hora de mesclar, trocar a base do
// cálculo:
//   - Base = os.prioridade (o valor manual) — NUNCA ignorar.
//   - tipo/origem/tempo em aberto viram AGRAVANTE por cima da base, só pra
//     ESCALAR visualmente (nunca rebaixar abaixo do que foi registrado).
//     Ex.: prioridade manual "baixa" só sobe na tela se corretiva/automática
//     ou se estourar o tempo em aberto — nunca desce de "baixa".
//   - Falta decidir o mapeamento: o campo novo tem 3 níveis
//     (alta/media/baixa) e OsPrioridade aqui tem 4 (urgente/alta/normal/
//     baixa) — "urgente" provavelmente vira um nível só alcançável por
//     agravante (nunca base manual direta), a confirmar com quem definiu o
//     campo antes de implementar.
import type { OS } from './db';

export type OsPrioridade = 'urgente' | 'alta' | 'normal' | 'baixa';

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
  os: Pick<OS, 'tipo' | 'origem' | 'status' | 'criado_em'>
): OsPrioridadeInfo {
  const now = Date.now();
  const criado = os.criado_em ? new Date(os.criado_em).getTime() : now;
  const elapsedHours = Math.max(0, (now - criado) / 3_600_000);
  const elapsedLabel = fmtDuration(elapsedHours);

  if (os.status === 'finalizada' || os.status === 'cancelada') {
    return { nivel: 'baixa', label: 'Encerrada', tone: 'neutral', elapsedHours, elapsedLabel };
  }

  const automatica = os.origem === 'hermes_automatica';

  if (os.tipo === 'corretiva') {
    if (automatica || elapsedHours >= URGENTE_CORRETIVA_HORAS) {
      return { nivel: 'urgente', label: 'Urgente', tone: 'red', elapsedHours, elapsedLabel };
    }
    return { nivel: 'alta', label: 'Alta', tone: 'warning', elapsedHours, elapsedLabel };
  }

  // preventiva
  if (elapsedHours >= ALTA_PREVENTIVA_HORAS) {
    return { nivel: 'alta', label: 'Alta', tone: 'warning', elapsedHours, elapsedLabel };
  }
  return { nivel: 'normal', label: 'Normal', tone: 'info', elapsedHours, elapsedLabel };
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
