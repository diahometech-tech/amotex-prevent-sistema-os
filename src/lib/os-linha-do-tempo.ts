// Linha do tempo da OS para o Painel do Condomínio (22/11): Chamado aberto →
// Técnico a caminho → Técnico chegou → Finalizado. Função pura, sem I/O.
import type { OS } from './db';
import { FUSO_OPERACAO, formatarDataCurta, hojeISO } from './os-agenda';

export type EstadoPasso = 'feito' | 'atual' | 'pendente' | 'pulado' | 'cancelado';

export interface PassoLinhaDoTempo {
  chave: 'aberto' | 'a_caminho' | 'chegou' | 'finalizado' | 'cancelado';
  rotulo: string;
  estado: EstadoPasso;
  /** "10:32" (hoje) ou "qua 19/11 10:32". Ausente quando o passo ainda não aconteceu. */
  quando?: string;
  /** Complemento curto (nome do técnico, "Não informado"…). */
  detalhe?: string;
}

export type SituacaoOS = 'aguardando' | 'a_caminho' | 'no_local' | 'finalizada' | 'cancelada';

type CamposOS = Pick<OS, 'tipo' | 'status' | 'criado_em'> &
  Partial<Pick<OS, 'a_caminho_em' | 'a_caminho_por' | 'entrada_em' | 'saida_em' | 'data_programada'>>;

const hora = new Intl.DateTimeFormat('pt-BR', { timeZone: FUSO_OPERACAO, hour: '2-digit', minute: '2-digit' });

/** "10:32" se foi hoje; "qua 19/11 10:32" nos outros dias. */
export function quandoCurto(iso: string | Date, agora: Date = new Date()): string {
  const t = new Date(iso);
  const dia = hojeISO(t);
  const h = hora.format(t);
  return dia === hojeISO(agora) ? h : `${formatarDataCurta(dia)} ${h}`;
}

export function situacaoDaOS(os: CamposOS): SituacaoOS {
  if (os.status === 'cancelada') return 'cancelada';
  if (os.status === 'finalizada') return 'finalizada';
  if (os.entrada_em || os.status === 'em_andamento') return 'no_local';
  if (os.a_caminho_em) return 'a_caminho';
  return 'aguardando';
}

export const ROTULO_SITUACAO: Record<SituacaoOS, string> = {
  aguardando: 'Aguardando técnico',
  a_caminho: 'Técnico a caminho',
  no_local: 'Técnico no local',
  finalizada: 'Finalizado',
  cancelada: 'Cancelado',
};

export function passosDaOS(os: CamposOS, agora: Date = new Date()): PassoLinhaDoTempo[] {
  const sit = situacaoDaOS(os);
  const corretiva = os.tipo === 'corretiva';

  const aberto: PassoLinhaDoTempo = corretiva
    ? { chave: 'aberto', rotulo: 'Chamado aberto', estado: 'feito', quando: quandoCurto(os.criado_em, agora) }
    : {
        chave: 'aberto',
        rotulo: 'Visita agendada',
        estado: 'feito',
        ...(os.data_programada ? { quando: formatarDataCurta(os.data_programada) } : {}),
      };

  // Passo que ficou para trás sem registro (técnico não avisou) fica "não informado".
  const passouDoACaminho = sit === 'no_local' || sit === 'finalizada';
  const aCaminho: PassoLinhaDoTempo = os.a_caminho_em
    ? {
        chave: 'a_caminho',
        rotulo: 'Técnico a caminho',
        estado: sit === 'a_caminho' ? 'atual' : 'feito',
        quando: quandoCurto(os.a_caminho_em, agora),
        ...(os.a_caminho_por ? { detalhe: os.a_caminho_por } : {}),
      }
    : {
        chave: 'a_caminho',
        rotulo: 'Técnico a caminho',
        estado: passouDoACaminho ? 'pulado' : 'pendente',
        ...(passouDoACaminho ? { detalhe: 'Não informado' } : {}),
      };

  const chegou: PassoLinhaDoTempo = os.entrada_em
    ? { chave: 'chegou', rotulo: 'Técnico chegou', estado: sit === 'no_local' ? 'atual' : 'feito', quando: quandoCurto(os.entrada_em, agora) }
    : {
        chave: 'chegou',
        rotulo: 'Técnico chegou',
        estado: sit === 'finalizada' ? 'pulado' : 'pendente',
        ...(sit === 'finalizada' ? { detalhe: 'Não informado' } : {}),
      };

  if (sit === 'cancelada') {
    const passos = [aberto];
    if (os.a_caminho_em) passos.push(aCaminho);
    if (os.entrada_em) passos.push(chegou);
    passos.push({
      chave: 'cancelado',
      rotulo: 'Cancelado',
      estado: 'cancelado',
      ...(os.saida_em ? { quando: quandoCurto(os.saida_em, agora) } : {}),
    });
    return passos;
  }

  const finalizado: PassoLinhaDoTempo =
    sit === 'finalizada'
      ? { chave: 'finalizado', rotulo: 'Finalizado', estado: 'feito', ...(os.saida_em ? { quando: quandoCurto(os.saida_em, agora) } : {}) }
      : { chave: 'finalizado', rotulo: 'Finalizado', estado: 'pendente' };
  return [aberto, aCaminho, chegou, finalizado];
}
