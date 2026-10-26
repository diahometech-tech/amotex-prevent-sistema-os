// Notificação ao n8n (fire-and-forget). Não bloqueia nem quebra o fluxo do app.
// Ative definindo N8N_WEBHOOK_URL no ambiente. Mesmo padrão já validado no
// protótipo do Agente Hermes (ver amotex-prevent-infra) — n8n é a camada de
// controle/execução, este app só avisa o que aconteceu.
//
// N8N_WEBHOOK_SECRET (opcional, recomendado): vai no header X-Amotex-Secret,
// que o Webhook do n8n confere (credencial "Header Auth") — o endpoint do n8n
// é público via Caddy, sem isso qualquer um dispararia aviso no Telegram.
import type { OS } from './db';

export type AmotexEvent =
  | 'os_created'
  | 'os_status_changed'
  | 'os_finalizada'
  | 'os_corretiva_aberta'
  | 'os_corretiva_assumida'
  | 'email_enviar'
  | 'alerta_recebido'
  | 'escalonamento_sem_ack';

export function webhookConfigurado(): boolean {
  return !!process.env.N8N_WEBHOOK_URL;
}

export function notifyN8n(event: AmotexEvent, os: Partial<OS>, extra: Record<string, unknown> = {}) {
  notifyN8nEvento(event, {
    os_id: os.id,
    condominio_id: os.condominio_id,
    tipo: os.tipo,
    origem: os.origem,
    status: os.status,
    ...extra,
  });
}

// E-mail sai pelo n8n (nó SMTP com a conta corporativa da Amotex) — decisão
// de 28/08: nada de SMTP dentro do app. Só fica ligado quando a conta estiver
// configurada no n8n (EMAIL_ENVIO_ATIVO=true no ambiente); até lá a tela
// oferece o texto pra copiar e enviar à mão.
export function emailAtivo(): boolean {
  return webhookConfigurado() && process.env.EMAIL_ENVIO_ATIVO === 'true';
}

export function notifyN8nEvento(event: AmotexEvent, dados: Record<string, unknown>) {
  const url = process.env.N8N_WEBHOOK_URL;
  if (!url) return; // Sem webhook configurado → no-op (modo local).

  const payload = { event, ...dados };

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (process.env.N8N_WEBHOOK_SECRET) headers['X-Amotex-Secret'] = process.env.N8N_WEBHOOK_SECRET;

  fetch(url, { method: 'POST', headers, body: JSON.stringify(payload) }).catch((e) =>
    console.error('Falha ao notificar n8n:', e)
  );
}
