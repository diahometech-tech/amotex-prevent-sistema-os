// Prazo de atendimento da corretiva (regra da Amotex, 23/10): toda corretiva
// é urgente e o técnico tem que CHEGAR ao condomínio em até 3 horas da
// abertura. A chegada é `os.entrada_em` (gravada em "Marcar Visitado" ou
// "Iniciar atendimento"). O reparo em si pode passar das 3h — o prazo é de
// chegada, não de conclusão. Função pura, sem I/O.
import type { OS } from './db';
import { FUSO_OPERACAO } from './os-agenda';

export const PRAZO_CHEGADA_CORRETIVA_HORAS = 3;
const PRAZO_MS = PRAZO_CHEGADA_CORRETIVA_HORAS * 3_600_000;

export type SituacaoSla = 'aguardando' | 'estourado' | 'cumprido' | 'cumprido_atrasado';

export interface SlaChegada {
  situacao: SituacaoSla;
  /** Instante limite de chegada (ms). */
  prazo: number;
  /** Texto curto pra badge/linha: "chegar até 14:30 · faltam 1h20". */
  label: string;
  /** Tom do Badge (src/components/ui/Badge.tsx). */
  tone: 'red' | 'warning' | 'success' | 'info';
}

function fmtMin(min: number): string {
  const m = Math.max(0, Math.round(min));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h}h${String(r).padStart(2, '0')}` : `${h}h`;
}

export function fmtHora(ms: number): string {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: FUSO_OPERACAO, hour: '2-digit', minute: '2-digit' }).format(ms);
}

/** SLA de chegada da corretiva; `null` pra preventiva ou OS cancelada. */
export function slaChegada(
  os: Pick<OS, 'tipo' | 'status' | 'criado_em'> & Partial<Pick<OS, 'entrada_em'>>,
  agora: number = Date.now()
): SlaChegada | null {
  if (os.tipo !== 'corretiva' || os.status === 'cancelada') return null;
  const aberta = new Date(os.criado_em).getTime();
  const prazo = aberta + PRAZO_MS;

  if (os.entrada_em) {
    const chegada = new Date(os.entrada_em).getTime();
    const levou = (chegada - aberta) / 60_000;
    return chegada <= prazo
      ? { situacao: 'cumprido', prazo, label: `chegou em ${fmtMin(levou)} · no prazo`, tone: 'success' }
      : { situacao: 'cumprido_atrasado', prazo, label: `chegou em ${fmtMin(levou)} · fora do prazo`, tone: 'warning' };
  }
  if (os.status === 'finalizada') {
    // Finalizada sem registrar chegada (OS antiga, anterior à regra) — não dá
    // pra afirmar se cumpriu.
    return { situacao: 'cumprido', prazo, label: 'chegada não registrada', tone: 'info' };
  }
  const restante = (prazo - agora) / 60_000;
  return restante >= 0
    ? { situacao: 'aguardando', prazo, label: `chegar até ${fmtHora(prazo)} · faltam ${fmtMin(restante)}`, tone: 'warning' }
    : { situacao: 'estourado', prazo, label: `prazo de chegada estourado há ${fmtMin(-restante)}`, tone: 'red' };
}

export interface ResumoSla {
  /** Corretivas com chegada registrada na janela. */
  atendidas: number;
  /** Dessas, quantas chegaram em até 3h. */
  noPrazo: number;
  /** Corretivas ainda sem chegada e já fora do prazo (agora). */
  estouradasAgora: number;
}

// Indicador pro gestor: % de corretivas atendidas no prazo, abertas nos
// últimos `dias` dias, e quantas estão estouradas neste momento.
export function resumoSla(oss: OS[], agora: number, dias = 30): ResumoSla {
  const corte = agora - dias * 86_400_000;
  const r: ResumoSla = { atendidas: 0, noPrazo: 0, estouradasAgora: 0 };
  for (const os of oss) {
    const sla = slaChegada(os, agora);
    if (!sla) continue;
    if (sla.situacao === 'estourado') r.estouradasAgora++;
    if (!os.entrada_em || new Date(os.criado_em).getTime() < corte) continue;
    r.atendidas++;
    if (sla.situacao === 'cumprido') r.noPrazo++;
  }
  return r;
}
