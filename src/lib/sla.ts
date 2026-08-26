// Utilitário de urgência da OS — prioridade + tempo em aberto.
// Funções puras (sem I/O) — seguras para uso no cliente e no servidor.
import type { OS } from './db';

export type UrgenciaTone = 'sky' | 'amber' | 'rose' | 'emerald';

export interface UrgenciaInfo {
  openHours: number; // horas desde a criação
  openLabel: string; // ex.: "3h", "2d 5h"
  tone: UrgenciaTone;
}

function fmtDuration(hours: number): string {
  const h = Math.floor(hours);
  if (h <= 0) return '<1h';
  if (h < 24) return `${h}h`;
  const days = Math.floor(h / 24);
  const rest = h % 24;
  return rest > 0 ? `${days}d ${rest}h` : `${days}d`;
}

// Combina prioridade + tempo em aberto num tom visual só — usado na lista de
// OS pra destacar o que precisa de atenção primeiro (não é SLA contratual,
// é priorização de rota de trabalho — ver docs/PRD-v2.md, seção Gestão de Rotas).
export function computeUrgencia(os: Pick<OS, 'criado_em' | 'status' | 'prioridade'>): UrgenciaInfo {
  const now = Date.now();
  const created = os.criado_em ? new Date(os.criado_em).getTime() : now;
  const openHours = Math.max(0, (now - created) / 3_600_000);

  if (os.status === 'finalizada' || os.status === 'cancelada') {
    return { openHours, openLabel: fmtDuration(openHours), tone: 'emerald' };
  }
  if (os.prioridade === 'alta' && openHours > 4) {
    return { openHours, openLabel: fmtDuration(openHours), tone: 'rose' };
  }
  if (os.prioridade === 'alta' || (os.prioridade === 'media' && openHours > 24)) {
    return { openHours, openLabel: fmtDuration(openHours), tone: 'amber' };
  }
  return { openHours, openLabel: fmtDuration(openHours), tone: 'sky' };
}

export interface RotaResumo {
  condominio_id: string;
  total: number;
  urgentes: number; // prioridade alta em aberto
}

// Agrega quantas OS urgentes cada condomínio tem — base da tela de Gestão de
// Rotas (lista de condomínios com status de visitação, priorizando urgência).
export function computeResumoRotas(oss: OS[]): RotaResumo[] {
  const porCondominio = new Map<string, OS[]>();
  for (const os of oss) {
    if (os.status === 'finalizada' || os.status === 'cancelada') continue;
    const lista = porCondominio.get(os.condominio_id) || [];
    lista.push(os);
    porCondominio.set(os.condominio_id, lista);
  }
  return Array.from(porCondominio.entries()).map(([condominio_id, lista]) => ({
    condominio_id,
    total: lista.length,
    urgentes: lista.filter((o) => o.prioridade === 'alta').length,
  }));
}
