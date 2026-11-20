// Fila de envio offline (só no navegador): foto e assinatura da OS.
//
// Problema: o técnico trabalha em casa de bombas e subsolo, sem sinal. Antes
// disto, a foto era mandada direto e, sem rede, dava "Erro de conexão" e se
// perdia — o técnico tinha que lembrar de tirar de novo.
//
// Agora todo envio entra PRIMEIRO na fila, gravada no aparelho (IndexedDB),
// e só depois é mandado. Se a rede falha, o item fica guardado e é reenviado
// sozinho: quando o navegador avisa que a rede voltou, a cada 30 s e quando o
// app volta pra frente. Sobrevive a fechar a aba ou reiniciar o celular — é
// enviado na próxima vez que o app abrir (o AppShell liga a sincronização).
//
// Regras:
// - Um envio por vez, na ordem em que entraram.
// - Falha de rede, 5xx, 408 e 429: tenta de novo depois (para a rodada).
// - 401 (sessão expirou): para e espera o técnico entrar de novo; nada se perde.
// - Outro 4xx (ex.: OS cancelada, arquivo inválido): o servidor recusou de
//   vez. O item fica marcado com o motivo pra pessoa ver e descartar — nunca
//   some sem aviso.
// - Foto leva client_id: se o upload chegou e a resposta se perdeu, o reenvio
//   não duplica (ver src/app/api/os/[id]/fotos/route.ts).
// - Assinatura: só vale a última de cada papel por OS (id fixo, sobrescreve).
// - Chegada ("Cheguei no local") sem sinal: guarda a hora do toque; o servidor
//   só aceita essa hora se a OS ainda não tem chegada.
//
// Se o IndexedDB não estiver disponível (aba anônima de alguns navegadores),
// a fila funciona só em memória: ainda reenvia enquanto a aba estiver aberta.
import type { Foto, OS } from './db';

export type ItemFila =
  | {
      id: string;
      tipo: 'foto';
      os_id: string;
      momento: 'antes' | 'depois';
      equipamento_id?: string;
      data: string; // data URL
      criado_em: string;
      tentativas: number;
      erro?: string;
      recusado?: boolean;
    }
  | {
      id: string;
      tipo: 'assinatura';
      os_id: string;
      papel: 'tecnico' | 'zelador';
      data: string;
      // Só na assinatura do zelador: quem assinou (viaja junto, mesmo offline).
      nome?: string;
      documento?: string;
      criado_em: string;
      tentativas: number;
      erro?: string;
      recusado?: boolean;
    }
  | {
      id: string;
      tipo: 'chegada';
      os_id: string;
      // Hora do aparelho no toque em "Cheguei no local" (o prazo de 3h da
      // corretiva conta daqui, mesmo que o envio demore).
      entrada_em: string;
      criado_em: string;
      tentativas: number;
      erro?: string;
      recusado?: boolean;
    };

export type ItemAssinatura = Extract<ItemFila, { tipo: 'assinatura' }>;

export type EventoFila =
  | { tipo: 'mudou' }
  | { tipo: 'foto_enviada'; item: ItemFila; foto: Foto }
  | { tipo: 'assinatura_enviada'; item: ItemFila; os: OS }
  | { tipo: 'chegada_enviada'; item: ItemFila; os: OS }
  | { tipo: 'sessao_expirada' };

const DB_NOME = 'amotex-fila-envio';
const STORE = 'itens';

let dbPromise: Promise<IDBDatabase | null> | null = null;
const memoria = new Map<string, ItemFila>();
const ouvintes = new Set<(e: EventoFila) => void>();

function abrirDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const req = indexedDB.open(DB_NOME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

async function comStore<T>(modo: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> {
  const db = await abrirDb();
  if (!db) return undefined;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, modo);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

async function gravar(item: ItemFila): Promise<void> {
  memoria.set(item.id, item);
  try {
    await comStore('readwrite', (s) => s.put(item));
  } catch {
    // sem espaço / IDB quebrado: fica na memória
  }
}

async function apagar(id: string): Promise<void> {
  memoria.delete(id);
  try {
    await comStore('readwrite', (s) => s.delete(id));
  } catch {
    // ignora
  }
}

async function lerItem(id: string): Promise<ItemFila | undefined> {
  if (memoria.has(id)) return memoria.get(id);
  try {
    return (await comStore('readonly', (s) => s.get(id))) as ItemFila | undefined;
  } catch {
    return undefined;
  }
}

// Uma assinatura nova pode substituir a antiga (mesmo id) enquanto a antiga
// está sendo enviada. Só mexe no registro se ele ainda for o mesmo que saiu.
async function aindaIgual(item: ItemFila): Promise<boolean> {
  const atual = await lerItem(item.id);
  return !!atual && atual.criado_em === item.criado_em;
}

async function atualizar(item: ItemFila, patch: Partial<Pick<ItemFila, 'tentativas' | 'erro' | 'recusado'>>) {
  if (await aindaIgual(item)) await gravar({ ...item, ...patch } as ItemFila);
}

export async function listarFila(): Promise<ItemFila[]> {
  let doBanco: ItemFila[] = [];
  try {
    doBanco = ((await comStore('readonly', (s) => s.getAll())) as ItemFila[] | undefined) ?? [];
  } catch {
    doBanco = [];
  }
  const porId = new Map<string, ItemFila>(doBanco.map((i) => [i.id, i]));
  for (const [id, item] of memoria) porId.set(id, item);
  return [...porId.values()].sort((a, b) => a.criado_em.localeCompare(b.criado_em));
}

function emitir(e: EventoFila) {
  for (const fn of ouvintes) {
    try {
      fn(e);
    } catch {
      // um ouvinte com erro não derruba os outros
    }
  }
}

export function ouvirFila(fn: (e: EventoFila) => void): () => void {
  ouvintes.add(fn);
  return () => {
    ouvintes.delete(fn);
  };
}

function novoId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  }
}

type NovoItem =
  | { tipo: 'foto'; os_id: string; momento: 'antes' | 'depois'; equipamento_id?: string; data: string }
  | { tipo: 'assinatura'; os_id: string; papel: 'tecnico' | 'zelador'; data: string; nome?: string; documento?: string }
  | { tipo: 'chegada'; os_id: string; entrada_em: string };

/** Guarda no aparelho e já tenta mandar. Devolve o item gravado. */
export async function enfileirar(novo: NovoItem): Promise<ItemFila> {
  const base = { criado_em: new Date().toISOString(), tentativas: 0 };
  const item: ItemFila =
    novo.tipo === 'foto'
      ? { ...novo, ...base, id: novoId() }
      : novo.tipo === 'chegada'
        ? { ...novo, ...base, id: `chegada-${novo.os_id}` }
        : // Assinatura: id fixo por OS + papel — a nova substitui a que ainda não subiu.
          { ...novo, ...base, id: `assinatura-${novo.os_id}-${novo.papel}` };
  await gravar(item);
  emitir({ tipo: 'mudou' });
  void processarFila();
  return item;
}

export async function descartarItem(id: string): Promise<void> {
  await apagar(id);
  emitir({ tipo: 'mudou' });
}

type Resultado = 'ok' | 'tentar_depois' | 'recusado' | 'sessao';

async function enviar(item: ItemFila): Promise<Resultado> {
  let res: Response;
  try {
    res =
      item.tipo === 'foto'
        ? await fetch(`/api/os/${item.os_id}/fotos`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              momento: item.momento,
              data: item.data,
              client_id: item.id,
              ...(item.equipamento_id ? { equipamento_id: item.equipamento_id } : {}),
            }),
          })
        : await fetch(`/api/os/${item.os_id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(
              item.tipo === 'chegada'
                ? { entrada_em: item.entrada_em, status: 'em_andamento' }
                : item.papel === 'tecnico'
                  ? { assinatura_tecnico: item.data }
                  : {
                      assinatura_zelador: item.data,
                      ...(item.nome ? { assinatura_zelador_nome: item.nome } : {}),
                      ...(item.documento ? { assinatura_zelador_documento: item.documento } : {}),
                    }
            ),
          });
  } catch {
    await atualizar(item, { tentativas: item.tentativas + 1, erro: 'Sem conexão' });
    return 'tentar_depois';
  }
  const json = await res.json().catch(() => ({}));
  if (res.ok) {
    if (await aindaIgual(item)) await apagar(item.id);
    if (item.tipo === 'foto' && json.foto) emitir({ tipo: 'foto_enviada', item, foto: json.foto });
    if (item.tipo === 'assinatura' && json.os) emitir({ tipo: 'assinatura_enviada', item, os: json.os });
    if (item.tipo === 'chegada' && json.os) emitir({ tipo: 'chegada_enviada', item, os: json.os });
    return 'ok';
  }
  if (res.status === 401) {
    await atualizar(item, { erro: 'Sessão expirada — entre de novo para enviar' });
    return 'sessao';
  }
  if (res.status >= 500 || res.status === 408 || res.status === 429) {
    await atualizar(item, { tentativas: item.tentativas + 1, erro: `Servidor indisponível (${res.status})` });
    return 'tentar_depois';
  }
  await atualizar(item, { tentativas: item.tentativas + 1, recusado: true, erro: json.error || `Recusado (${res.status})` });
  return 'recusado';
}

let processando: Promise<void> | null = null;

/** Manda o que estiver na fila, um por vez. Chamadas simultâneas se juntam. */
export function processarFila(): Promise<void> {
  if (processando) return processando;
  const rodada = (async () => {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    const itens = (await listarFila()).filter((i) => !i.recusado);
    for (const item of itens) {
      const r = await enviar(item);
      emitir({ tipo: 'mudou' });
      if (r === 'sessao') {
        emitir({ tipo: 'sessao_expirada' });
        return;
      }
      if (r === 'tentar_depois') return; // rede caiu: espera a próxima rodada
    }
  })();
  processando = rodada;
  // Libera DEPOIS de atribuir: sem rede a rodada termina na hora, e um
  // `finally` dentro dela rodaria antes da atribuição — a fila ficava presa
  // numa rodada já encerrada e nunca mais tentava.
  const liberar = () => {
    if (processando === rodada) processando = null;
  };
  rodada.then(liberar, liberar);
  return rodada;
}

/** Liga o reenvio automático. Chamado uma vez pelo AppShell. */
export function iniciarSincronizacao(): () => void {
  const tentar = () => void processarFila();
  const aoVoltar = () => {
    if (document.visibilityState === 'visible') tentar();
  };
  window.addEventListener('online', tentar);
  document.addEventListener('visibilitychange', aoVoltar);
  const timer = window.setInterval(tentar, 30_000);
  tentar();
  return () => {
    window.removeEventListener('online', tentar);
    document.removeEventListener('visibilitychange', aoVoltar);
    window.clearInterval(timer);
  };
}
