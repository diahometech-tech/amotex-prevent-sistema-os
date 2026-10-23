// Resultado do aviso de corretiva no Telegram (ver notificacao-corretiva.ts,
// que é só servidor) — aqui fica só o tipo e o texto pra tela, sem I/O, pra
// poder ser importado no cliente.
export interface ResultadoAviso {
  /** Aviso saiu pro n8n (webhook configurado e alguém pra receber). */
  enviado: boolean;
  destinatarios: number;
  /** Quando não saiu, por quê — mostrado na tela pra quem abriu a OS. */
  motivo?: string;
}

export function textoAviso(aviso: ResultadoAviso): { texto: string; ok: boolean } {
  if (aviso.enviado) {
    return { texto: `Aviso enviado no Telegram para ${aviso.destinatarios} pessoa${aviso.destinatarios > 1 ? 's' : ''}.`, ok: true };
  }
  return { texto: `Aviso NÃO enviado: ${aviso.motivo ?? 'motivo desconhecido'}. Avise a equipe por telefone.`, ok: false };
}
