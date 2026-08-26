// Notificação ao n8n (fire-and-forget). Não bloqueia nem quebra o fluxo do app.
// Ative definindo N8N_WEBHOOK_URL no ambiente, ex.:
//   N8N_WEBHOOK_URL=https://n8n.mvhometech.com.br/webhook/nexusflow-os
import type { Dossier } from './db';

export type NexusEvent =
  | 'os_created'
  | 'step_changed'
  | 'sla_due'
  | 'terceiro_vinculo_done'
  // Eventos direcionados ao CERTIFICADOR (operador_certificacao). O n8n usa
  // o tipo do evento para acionar SÓ o certificador nestes 3 casos:
  | 'cert_demanded'          // nova demanda de certificação chegou para ele
  | 'cert_task_done'         // tarefa que ELE atribuiu foi concluída
  | 'cert_doc_resubmitted'   // documento que ele recusou foi reenviado
  // Certificações concluídas — cada uma é distinta e cobrada individualmente,
  // notifica gestores com quem/quando concluiu:
  | 'bird_id_done'
  | 'a1_done'
  // Reagendamento da agenda de certificação — fluxo de aprovação do gestor:
  | 'reagendamento_solicitado'  // certificador pediu troca → notifica o gestor
  | 'reagendamento_resolvido';  // gestor aprovou/recusou → notifica o certificador

export function notifyN8n(event: NexusEvent, dossier: Partial<Dossier>, extra: Record<string, unknown> = {}) {
  const url = process.env.N8N_WEBHOOK_URL;
  if (!url) return; // Sem webhook configurado → no-op (modo local).

  const payload = {
    event,
    os_id: dossier.id,
    client_name: dossier.client_name,
    cpf: dossier.cpf,
    gov_level: dossier.gov_level,
    current_step: dossier.current_step,
    captured_by: dossier.captured_by,
    resp_certificacao: dossier.resp_certificacao,
    resp_abertura: dossier.resp_abertura,
    sla_deadline: dossier.sla_deadline,
    protocolo: dossier.protocolo,
    ...extra,
  };

  // Não aguardamos a resposta; apenas registramos falhas.
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).catch((e) => console.error('Falha ao notificar n8n:', e));
}
