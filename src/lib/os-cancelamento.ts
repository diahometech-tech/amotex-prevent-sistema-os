// Cancelamento do chamado pelo próprio condomínio (22/11). Regra pura, sem
// I/O: a tela usa para mostrar ou esconder o botão e o servidor usa para
// decidir de verdade (src/app/api/os/[id]/cancelar/route.ts).
//
//   - só corretiva, e só enquanto o técnico não chegou;
//   - antes do "a caminho": a qualquer momento;
//   - depois do "a caminho": só nos primeiros 5 minutos;
//   - depois disso, só ligando para a Amotex.
import type { OS } from './db';

export const JANELA_CANCELAR_APOS_A_CAMINHO_MS = 5 * 60_000;

export type MotivoSemCancelamento = 'nao_corretiva' | 'encerrada' | 'ja_chegou' | 'prazo_expirado';

export type PermissaoCancelamento =
  | { pode: true; /** ms que ainda restam (só depois do "a caminho"); ausente = sem limite. */ restanteMs?: number }
  | { pode: false; motivo: MotivoSemCancelamento; mensagem: string };

type CampoOS = Pick<OS, 'tipo' | 'status'> & Partial<Pick<OS, 'entrada_em' | 'a_caminho_em'>>;

export const MSG_LIGUE_AMOTEX = 'O técnico já está a caminho; para cancelar, ligue para a Amotex.';

export function permissaoCancelarChamado(os: CampoOS, agora: number = Date.now()): PermissaoCancelamento {
  if (os.tipo !== 'corretiva') {
    return { pode: false, motivo: 'nao_corretiva', mensagem: 'Só é possível cancelar um chamado de corretiva. Para outra visita, ligue para a Amotex.' };
  }
  if (os.status === 'finalizada' || os.status === 'cancelada') {
    return { pode: false, motivo: 'encerrada', mensagem: 'Este chamado já foi encerrado.' };
  }
  if (os.entrada_em || os.status === 'em_andamento') {
    return { pode: false, motivo: 'ja_chegou', mensagem: 'O técnico já chegou ao local; para cancelar, ligue para a Amotex.' };
  }
  if (os.a_caminho_em) {
    // criado_em/a_caminho_em chegam como Date do pg e como string do JSON local.
    const desde = agora - new Date(os.a_caminho_em).getTime();
    if (desde > JANELA_CANCELAR_APOS_A_CAMINHO_MS) {
      return { pode: false, motivo: 'prazo_expirado', mensagem: MSG_LIGUE_AMOTEX };
    }
    return { pode: true, restanteMs: Math.max(0, JANELA_CANCELAR_APOS_A_CAMINHO_MS - Math.max(0, desde)) };
  }
  return { pode: true };
}
