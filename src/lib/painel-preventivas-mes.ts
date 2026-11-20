// Painel do mês das preventivas (tela de Rotas, escritório) — função pura.
// Por técnico e no total: quantas preventivas o mês tem, quantas já foram
// feitas, quantas faltam, quantos dias úteis restam e o ritmo por dia que
// fecha o mês.
import type { OS } from './db';
import { DIAS_UTEIS_PREVENTIVA, ehDiaUtil, somarDias } from './os-agenda';

export interface LinhaPainelMes {
  tecnico_id: string; // '' = sem técnico
  feitas: number;
  faltam: number;
  total: number;
  /** Ritmo necessário (visitas por dia útil restante); null sem dia útil restante. */
  ritmo: number | null;
}

export interface PainelMes {
  mes: string;
  diasUteisRestantes: number;
  porTecnico: LinhaPainelMes[];
  total: LinhaPainelMes;
}

/** Dias úteis de hoje (inclusive) até o fim do mês de `mes`. Mês passado = 0; futuro = todos. */
export function diasUteisRestantes(mes: string, hoje: string, diasUteis: readonly number[] = DIAS_UTEIS_PREVENTIVA): number {
  let n = 0;
  for (let d = `${mes}-01`; d.startsWith(mes); d = somarDias(d, 1)) {
    if (d >= hoje && ehDiaUtil(d, diasUteis)) n++;
  }
  return n;
}

function linha(tecnico_id: string, feitas: number, faltam: number, restantes: number): LinhaPainelMes {
  return {
    tecnico_id, feitas, faltam, total: feitas + faltam,
    // Arredonda pra cima com uma casa: 0,4 visita/dia não vira "1" nem "0".
    ritmo: restantes > 0 ? Math.ceil((faltam / restantes) * 10) / 10 : null,
  };
}

export function painelPreventivasMes(
  oss: Pick<OS, 'tipo' | 'status' | 'data_programada' | 'tecnico_id'>[],
  mes: string,
  hoje: string,
  diasUteis: readonly number[] = DIAS_UTEIS_PREVENTIVA
): PainelMes {
  const restantes = diasUteisRestantes(mes, hoje, diasUteis);
  const contagem = new Map<string, { feitas: number; faltam: number }>();
  for (const o of oss) {
    if (o.tipo !== 'preventiva' || o.status === 'cancelada' || !o.data_programada?.startsWith(mes)) continue;
    const c = contagem.get(o.tecnico_id ?? '') ?? { feitas: 0, faltam: 0 };
    if (o.status === 'finalizada') c.feitas++;
    else c.faltam++;
    contagem.set(o.tecnico_id ?? '', c);
  }
  let feitas = 0;
  let faltam = 0;
  const porTecnico = [...contagem.entries()].map(([id, c]) => {
    feitas += c.feitas;
    faltam += c.faltam;
    return linha(id, c.feitas, c.faltam, restantes);
  });
  return { mes, diasUteisRestantes: restantes, porTecnico, total: linha('', feitas, faltam, restantes) };
}
