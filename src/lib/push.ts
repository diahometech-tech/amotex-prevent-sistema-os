// Aviso no celular (Web Push): a notificação aparece na barra do aparelho e,
// com o app aberto, também dentro dele. Só servidor.
//
// Uso por outras partes do sistema:
//   await enviarPushUsuarios([id1, id2], { titulo, corpo, url: '/?os=<id>' });
// Nunca lança: erro de envio vai só para o log, a requisição principal segue.
// Inscrição que o serviço de push recusa com 404/410 (aparelho desinstalou o
// app ou revogou a permissão) é apagada na hora.
//
// Chaves VAPID: se VAPID_PUBLIC_KEY e VAPID_PRIVATE_KEY existirem no ambiente,
// valem elas. Senão o app gera um par na primeira necessidade e guarda na
// tabela `configuracao`. A chave privada nunca sai deste arquivo; só a pública
// é devolvida (GET /api/push/chave).
import webpush from 'web-push';
import { Database } from './db';

const CHAVE_PUBLICA = 'push_vapid_public';
const CHAVE_PRIVADA = 'push_vapid_private';
const TIMEOUT_MS = 8000;
// Aviso de corretiva vale por 3h (prazo de chegada); depois disso é velho.
const TTL_SEGUNDOS = 3 * 60 * 60;

export interface AvisoPush {
  titulo: string;
  corpo: string;
  /** Caminho aberto ao tocar na notificação, ex.: `/?os=<id>`. */
  url?: string;
  /** Mesmo `tag` substitui a notificação anterior em vez de empilhar. */
  tag?: string;
}

export interface ResultadoPush {
  /** Usuários que receberam em pelo menos um aparelho. */
  usuariosAlcancados: string[];
  enviados: number;
  /** Inscrições apagadas porque o serviço de push disse que não existem mais. */
  removidas: number;
  falhas: number;
}

interface Chaves {
  publica: string;
  privada: string;
}

let chavesEmMemoria: Promise<Chaves> | null = null;

async function carregarChaves(): Promise<Chaves> {
  const publicaEnv = process.env.VAPID_PUBLIC_KEY?.trim();
  const privadaEnv = process.env.VAPID_PRIVATE_KEY?.trim();
  if (publicaEnv && privadaEnv) return { publica: publicaEnv, privada: privadaEnv };

  const [publica, privada] = await Promise.all([
    Database.getConfiguracao(CHAVE_PUBLICA),
    Database.getConfiguracao(CHAVE_PRIVADA),
  ]);
  if (publica && privada) return { publica, privada };

  const par = webpush.generateVAPIDKeys();
  await Database.setConfiguracao(CHAVE_PRIVADA, par.privateKey);
  await Database.setConfiguracao(CHAVE_PUBLICA, par.publicKey);
  return { publica: par.publicKey, privada: par.privateKey };
}

function chaves(): Promise<Chaves> {
  if (!chavesEmMemoria) {
    chavesEmMemoria = carregarChaves().catch((e) => {
      chavesEmMemoria = null; // tenta de novo na próxima chamada
      throw e;
    });
  }
  return chavesEmMemoria;
}

/** Chave pública para o navegador assinar o aviso. Gera o par se ainda não existir. */
export async function chavePublicaPush(): Promise<string> {
  return (await chaves()).publica;
}

// O VAPID exige que o "subject" seja https: ou mailto:. APP_URL em http (teste
// local) não serve, então cai no endereço padrão.
function assunto(): string {
  const url = process.env.APP_URL?.trim().replace(/\/$/, '');
  return url && url.startsWith('https://') ? url : 'https://os.amotexprevent.com.br';
}

// Hosts dos serviços de push dos navegadores. O servidor faz uma chamada para
// o endpoint que o usuário informou, então em produção só aceita estes
// (evita usar o app para chamar endereço interno). Em desenvolvimento aceita
// também localhost, para testar.
const SUFIXOS_PUSH = [
  'googleapis.com',
  'google.com',
  'mozilla.com',
  'push.apple.com',
  'notify.windows.com',
  'opera.com',
];

export function endpointValido(endpoint: unknown): endpoint is string {
  if (typeof endpoint !== 'string' || endpoint.length > 2048) return false;
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (process.env.NODE_ENV !== 'production') {
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (local && (url.protocol === 'http:' || url.protocol === 'https:')) return true;
  }
  if (url.protocol !== 'https:') return false;
  return SUFIXOS_PUSH.some((s) => url.hostname === s || url.hostname.endsWith(`.${s}`));
}

function statusDoErro(e: unknown): number | undefined {
  const s = (e as { statusCode?: unknown } | null)?.statusCode;
  return typeof s === 'number' ? s : undefined;
}

export async function enviarPushUsuarios(usuarioIds: string[], aviso: AvisoPush): Promise<ResultadoPush> {
  const resultado: ResultadoPush = { usuariosAlcancados: [], enviados: 0, removidas: 0, falhas: 0 };
  try {
    const ids = [...new Set(usuarioIds)];
    if (ids.length === 0) return resultado;
    const inscricoes = await Database.getPushInscricoesByUsuarios(ids);
    if (inscricoes.length === 0) return resultado;

    const { publica, privada } = await chaves();
    const detalhes = { subject: assunto(), publicKey: publica, privateKey: privada };
    const payload = JSON.stringify({ titulo: aviso.titulo, corpo: aviso.corpo, url: aviso.url ?? '/', tag: aviso.tag });
    const alcancados = new Set<string>();

    await Promise.all(
      inscricoes.map(async (i) => {
        try {
          await webpush.sendNotification(
            { endpoint: i.endpoint, keys: { p256dh: i.p256dh, auth: i.auth } },
            payload,
            { vapidDetails: detalhes, TTL: TTL_SEGUNDOS, urgency: 'high', timeout: TIMEOUT_MS }
          );
          resultado.enviados++;
          alcancados.add(i.usuario_id);
          await Database.tocarPushInscricao(i.id).catch(() => {});
        } catch (e) {
          const status = statusDoErro(e);
          if (status === 404 || status === 410) {
            await Database.deletePushInscricaoByEndpoint(i.endpoint).catch(() => {});
            resultado.removidas++;
          } else {
            resultado.falhas++;
            console.error('[push] falha ao enviar aviso:', status ?? (e as Error)?.message);
          }
        }
      })
    );
    resultado.usuariosAlcancados = [...alcancados];
  } catch (e) {
    console.error('[push] erro ao enviar aviso:', (e as Error)?.message);
  }
  return resultado;
}

/** Ids de quem tem pelo menos um aparelho com o aviso ligado. Nunca lança. */
export async function usuariosComPush(): Promise<Set<string>> {
  try {
    return new Set(await Database.getUsuarioIdsComPush());
  } catch (e) {
    console.error('[push] erro ao listar inscrições:', (e as Error)?.message);
    return new Set();
  }
}
