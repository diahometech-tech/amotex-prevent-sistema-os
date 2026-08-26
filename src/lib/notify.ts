// Notificação ao n8n (fire-and-forget). Não bloqueia nem quebra o fluxo do app.
// Ative definindo N8N_WEBHOOK_URL no ambiente. Mesmo padrão já validado no
// protótipo do Agente Hermes (ver amotex-prevent-infra) — n8n é a camada de
// controle/execução, este app só avisa o que aconteceu.
import type { OS } from './db';

export type AmotexEvent =
  | 'os_created'
  | 'os_status_changed'
  | 'os_finalizada'
  | 'alerta_recebido'
  | 'escalonamento_sem_ack';

export function notifyN8n(event: AmotexEvent, os: Partial<OS>, extra: Record<string, unknown> = {}) {
  const url = process.env.N8N_WEBHOOK_URL;
  if (!url) return; // Sem webhook configurado → no-op (modo local).

  const payload = {
    event,
    os_id: os.id,
    condominio_id: os.condominio_id,
    tipo: os.tipo,
    origem: os.origem,
    status: os.status,
    ...extra,
  };

  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).catch((e) => console.error('Falha ao notificar n8n:', e));
}
