// Utilitários de SLA e gargalos do NexusFlow.
// Funções puras (sem I/O) — seguras para uso no cliente e no servidor.
import type { Dossier } from './db';

export type SlaStatus = 'ok' | 'atencao' | 'estourado' | 'concluido';

// Abaixo deste tempo restante (em horas) a OS entra em estado de ATENÇÃO.
const ATENCAO_THRESHOLD_H = 12;

export interface SlaInfo {
  status: SlaStatus;
  elapsedHours: number; // horas decorridas desde a criação
  remainingHours: number; // horas até o prazo (negativo = atrasado)
  elapsedLabel: string; // ex.: "3h", "2d 5h"
  remainingLabel: string; // ex.: "vence em 18h", "atrasado 4h", "concluído"
  /** Chave de cor semântica para estilização (sky/amber/rose/emerald). */
  tone: 'sky' | 'amber' | 'rose' | 'emerald';
}

// Formata uma duração em horas (>=0) como "Nd Mh" ou "Nh" ou "<1h".
function fmtDuration(hours: number): string {
  const h = Math.floor(hours);
  if (h <= 0) return '<1h';
  if (h < 24) return `${h}h`;
  const days = Math.floor(h / 24);
  const rest = h % 24;
  return rest > 0 ? `${days}d ${rest}h` : `${days}d`;
}

export function computeSla(d: Pick<Dossier, 'created_at' | 'sla_deadline' | 'current_step' | 'empresa_aberta'>): SlaInfo {
  const now = Date.now();
  const created = d.created_at ? new Date(d.created_at).getTime() : now;
  const elapsedHours = Math.max(0, (now - created) / 3_600_000);

  // OS concluída não tem pressão de SLA.
  if (d.current_step === 'finalizado' || d.empresa_aberta) {
    return {
      status: 'concluido',
      elapsedHours,
      remainingHours: 0,
      elapsedLabel: fmtDuration(elapsedHours),
      remainingLabel: 'concluído',
      tone: 'emerald',
    };
  }

  // Sem prazo definido → tratamos como "no prazo" e só mostramos o decorrido.
  if (!d.sla_deadline) {
    return {
      status: 'ok',
      elapsedHours,
      remainingHours: Infinity,
      elapsedLabel: fmtDuration(elapsedHours),
      remainingLabel: 'sem prazo',
      tone: 'sky',
    };
  }

  const deadline = new Date(d.sla_deadline).getTime();
  const remainingHours = (deadline - now) / 3_600_000;

  if (remainingHours < 0) {
    return {
      status: 'estourado',
      elapsedHours,
      remainingHours,
      elapsedLabel: fmtDuration(elapsedHours),
      remainingLabel: `atrasado ${fmtDuration(-remainingHours)}`,
      tone: 'rose',
    };
  }

  if (remainingHours < ATENCAO_THRESHOLD_H) {
    return {
      status: 'atencao',
      elapsedHours,
      remainingHours,
      elapsedLabel: fmtDuration(elapsedHours),
      remainingLabel: `vence em ${fmtDuration(remainingHours)}`,
      tone: 'amber',
    };
  }

  return {
    status: 'ok',
    elapsedHours,
    remainingHours,
    elapsedLabel: fmtDuration(elapsedHours),
    remainingLabel: `vence em ${fmtDuration(remainingHours)}`,
    tone: 'sky',
  };
}

export interface SectorBottleneck {
  step: 'captacao' | 't1' | 't2' | 't3_abertura' | 't3_cert';
  label: string;
  total: number;
  estourados: number;
  atencao: number;
  /** Maior tempo de espera (horas decorridas) entre as OS abertas do setor. */
  maxWaitHours: number;
  maxWaitLabel: string;
}

const SECTOR_LABELS: Record<SectorBottleneck['step'], string> = {
  captacao: 'Captação',
  t1: 'E1 · Risco',
  t2: 'E2 · Cadastro',
  t3_abertura: 'E3 · Abertura',
  t3_cert: 'E4 · Certificação',
};

function calcSector(
  dossiers: Dossier[],
  filter: (d: Dossier) => boolean
): Pick<SectorBottleneck, 'total' | 'estourados' | 'atencao' | 'maxWaitHours' | 'maxWaitLabel'> {
  const inStep = dossiers.filter((d) => {
    if (d.current_step === 'finalizado' || d.empresa_aberta) return false;
    return filter(d);
  });
  let estourados = 0;
  let atencao = 0;
  let maxWaitHours = 0;
  for (const d of inStep) {
    const sla = computeSla(d);
    if (sla.status === 'estourado') estourados++;
    else if (sla.status === 'atencao') atencao++;
    if (sla.elapsedHours > maxWaitHours) maxWaitHours = sla.elapsedHours;
  }
  return { total: inStep.length, estourados, atencao, maxWaitHours, maxWaitLabel: inStep.length ? fmtDuration(maxWaitHours) : '—' };
}

// Agrega gargalos por setor a partir da lista completa de dossiês.
export function computeBottlenecks(dossiers: Dossier[]): SectorBottleneck[] {
  const sectors: { step: SectorBottleneck['step']; filter: (d: Dossier) => boolean }[] = [
    { step: 'captacao',    filter: (d) => d.current_step === 'captacao' || d.status === 'captado' },
    { step: 't1',          filter: (d) => d.current_step === 't1' },
    { step: 't2',          filter: (d) => d.current_step === 't2' },
    { step: 't3_abertura', filter: (d) => d.current_step === 't3' && !d.abertura_done },
    { step: 't3_cert',     filter: (d) => d.current_step === 't3' && !d.a1_done },
  ];

  return sectors.map(({ step, filter }) => ({
    step,
    label: SECTOR_LABELS[step],
    ...calcSector(dossiers, filter),
  }));
}
