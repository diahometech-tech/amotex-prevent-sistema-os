// Notificação push real (Web Push API) — funciona mesmo com o app fechado,
// desde que o usuário tenha instalado o dashboard (Adicionar à Tela de
// Início) e autorizado notificações uma vez. Fire-and-forget: nunca lança
// pro chamador, só loga — não pode travar o fluxo principal (tarefa,
// cobrança, etc. continuam funcionando mesmo sem push configurado).
//
// Variáveis de ambiente necessárias (gerar uma vez com
// `node -e "console.log(require('web-push').generateVAPIDKeys())"` e nunca
// trocar depois — trocar invalida todas as inscrições existentes):
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:alguem@contex.com.br)
// Sem essas variáveis, o envio é pulado silenciosamente (like notify.ts).
import webpush from 'web-push';
import { Database } from './db';

let configured = false;
function ensureConfigured(): boolean {
  if (configured) return true;
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || 'mailto:contato@contex.com.br';
  if (!pub || !priv) return false;
  webpush.setVapidDetails(subject, pub, priv);
  configured = true;
  return true;
}

export interface PushPayload {
  title: string;
  body: string;
  // Rota pra abrir ao clicar na notificação (ex.: deep link pra uma OS).
  url?: string;
}

// Envia push pra TODAS as inscrições do usuário (pode ter mais de um
// dispositivo). Remove inscrições expiradas/inválidas (404/410) automaticamente.
export async function sendPushToUser(userName: string, payload: PushPayload): Promise<void> {
  if (!ensureConfigured()) return;
  try {
    const subs = await Database.getPushSubscriptionsByUser(userName);
    if (subs.length === 0) return;
    await Promise.all(subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify(payload)
        );
      } catch (e: unknown) {
        const statusCode = (e as { statusCode?: number })?.statusCode;
        if (statusCode === 404 || statusCode === 410) {
          // Inscrição expirada (navegador desinstalado, permissão revogada, etc.)
          await Database.deletePushSubscriptionByEndpoint(sub.endpoint);
        } else {
          console.error('[push] Falha ao enviar notificação:', e);
        }
      }
    }));
  } catch (e) {
    console.error('[push] Erro geral ao enviar push:', e);
  }
}
