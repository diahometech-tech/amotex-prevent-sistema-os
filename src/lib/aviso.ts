// Resultado do aviso de corretiva no Telegram (ver notificacao-corretiva.ts,
// que é só servidor) — aqui fica só o tipo e o texto pra tela, sem I/O, pra
// poder ser importado no cliente.
export interface ResultadoAviso {
  /** Aviso saiu pro n8n (webhook configurado e alguém pra receber). */
  enviado: boolean;
  destinatarios: number;
  /** Quando não saiu, por quê — mostrado na tela pra quem abriu a OS. */
  motivo?: string;
  /** Técnicos de plantão avisados (vazio/ausente = aviso foi a todos). */
  plantao?: string[];
  /** De plantão mas sem Telegram: o aviso não chegou neles. */
  plantaoSemTelegram?: string[];
  /** Horário comercial (todos os técnicos de corretiva) ou plantão. */
  periodo?: 'comercial' | 'plantao';
  /** Fora do horário comercial e ninguém marcado de plantão: foi a todos os técnicos. */
  semPlantonista?: boolean;
  /** Horário comercial ou plantão vazio: técnicos-alvo sem Telegram (não receberam). */
  tecnicosSemTelegram?: string[];
  /** Nenhum técnico recebeu o aviso (só gestores/secretária): ninguém foi chamado pra atender. */
  semTecnicos?: boolean;
  /** OS já com técnico: o aviso foi só pra ele (+ escritório). */
  atribuidaA?: string;
  /** Técnico da OS sem Telegram: o aviso não chegou nele. */
  atribuidaSemTelegram?: boolean;
}

export function textoAviso(aviso: ResultadoAviso): { texto: string; ok: boolean } {
  if (aviso.enviado) {
    const quem = aviso.atribuidaA
      ? ` (atribuída a ${aviso.atribuidaA})`
      : aviso.plantao?.length
        ? ` (plantão: ${aviso.plantao.join(', ')})`
        : aviso.periodo === 'comercial'
          ? ' (horário comercial: todos os técnicos de corretiva)'
          : '';
    const alertas = [
      aviso.plantaoSemTelegram?.length
        ? `Atenção: ${aviso.plantaoSemTelegram.join(', ')} ${aviso.plantaoSemTelegram.length > 1 ? 'estão' : 'está'} de plantão sem Telegram cadastrado — avise por telefone.`
        : '',
      aviso.semPlantonista
        ? 'Atenção: fora do horário comercial e ninguém está marcado de plantão — o aviso foi a todos os técnicos de corretiva. Marque o plantonista no Dashboard.'
        : '',
      aviso.tecnicosSemTelegram?.length
        ? `Atenção: ${aviso.tecnicosSemTelegram.join(', ')} ${aviso.tecnicosSemTelegram.length > 1 ? 'estão' : 'está'} sem Telegram cadastrado — avise por telefone.`
        : '',
      aviso.semTecnicos ? 'Atenção: nenhum técnico recebeu o aviso — ligue para os técnicos.' : '',
      aviso.atribuidaSemTelegram
        ? `Atenção: ${aviso.atribuidaA ?? 'o técnico'} não tem Telegram cadastrado — avise por telefone.`
        : '',
    ].filter(Boolean);
    return {
      texto: `Aviso enviado no Telegram para ${aviso.destinatarios} pessoa${aviso.destinatarios > 1 ? 's' : ''}${quem}.${alertas.length ? ' ' + alertas.join(' ') : ''}`,
      ok: alertas.length === 0,
    };
  }
  return { texto: `Aviso NÃO enviado: ${aviso.motivo ?? 'motivo desconhecido'}. Avise a equipe por telefone.`, ok: false };
}
