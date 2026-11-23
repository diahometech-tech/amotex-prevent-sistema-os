'use client';

// App no celular: instalar na tela inicial e ligar os avisos (Web Push).
// Um único estado, criado no AppShell e lido pelo menu e pela Ajuda
// (AppCelularContext). O service worker (public/sw.js) só trata aviso; não
// guarda nada em cache.
import { createContext, useCallback, useContext, useEffect, useState, useSyncExternalStore } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

// ---------- Instalação ----------
// O navegador dispara `beforeinstallprompt` uma vez, cedo; guardamos o evento
// aqui, fora do React, para o botão "Instalar o app" poder usá-lo depois.
let eventoInstalacao: BeforeInstallPromptEvent | null = null;
let instaladoAgora = false;
const ouvintes = new Set<() => void>();
const avisar = () => ouvintes.forEach((f) => f());

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    eventoInstalacao = e as BeforeInstallPromptEvent;
    avisar();
  });
  window.addEventListener('appinstalled', () => {
    eventoInstalacao = null;
    instaladoAgora = true;
    avisar();
  });
}

function assinar(cb: () => void) {
  ouvintes.add(cb);
  return () => {
    ouvintes.delete(cb);
  };
}

function emModoApp(): boolean {
  if (instaladoAgora) return true;
  const nav = navigator as Navigator & { standalone?: boolean };
  return window.matchMedia('(display-mode: standalone)').matches || nav.standalone === true;
}

function ehIPhone(): boolean {
  const ua = navigator.userAgent;
  // iPadOS novo se apresenta como Mac com tela de toque.
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

/** 'instalado' = já está na tela inicial; 'nativo' = o navegador oferece instalar; 'ios' = só pelo menu Compartilhar; 'nenhum' = nada a oferecer. */
export type EstadoInstalacao = 'instalado' | 'nativo' | 'ios' | 'nenhum';

function estadoInstalacao(): EstadoInstalacao {
  if (emModoApp()) return 'instalado';
  if (eventoInstalacao) return 'nativo';
  if (ehIPhone()) return 'ios';
  return 'nenhum';
}

// ---------- Avisos ----------
// carregando | indisponivel (navegador sem suporte) | instalar (iPhone: antes
// precisa instalar) | bloqueado (permissão negada) | desligado | ligado
export type EstadoAvisos = 'carregando' | 'indisponivel' | 'instalar' | 'bloqueado' | 'desligado' | 'ligado';

function suportaPush(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

function chaveParaBytes(base64Url: string): Uint8Array<ArrayBuffer> {
  const pad = '='.repeat((4 - (base64Url.length % 4)) % 4);
  const bin = atob((base64Url + pad).replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function registroDoServiceWorker(): Promise<ServiceWorkerRegistration> {
  await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  return navigator.serviceWorker.ready;
}

export interface AppCelular {
  instalacao: EstadoInstalacao;
  /** Abre o convite de instalação do navegador (só quando `instalacao === 'nativo'`). */
  instalar: () => Promise<void>;
  avisos: EstadoAvisos;
  /** Pedido de permissão ou chamada ao servidor em andamento. */
  ocupado: boolean;
  /** Frase para mostrar ao usuário depois de uma ação (sucesso ou erro). */
  mensagem: string;
  ligarAvisos: () => Promise<void>;
  desligarAvisos: () => Promise<void>;
  enviarTeste: () => Promise<void>;
}

export function useAppCelularEstado(): AppCelular {
  const instalacao = useSyncExternalStore<EstadoInstalacao>(assinar, estadoInstalacao, () => 'nenhum');
  const [avisos, setAvisos] = useState<EstadoAvisos>('carregando');
  const [ocupado, setOcupado] = useState(false);
  const [mensagem, setMensagem] = useState('');

  // Registra o service worker e descobre se ESTE aparelho já recebe aviso
  // para ESTE usuário (a inscrição pode ser de quem usou o aparelho antes).
  useEffect(() => {
    let cancelado = false;
    (async () => {
      if (!suportaPush()) {
        // iPhone com o Safari comum: o aviso só existe com o app instalado.
        if (!cancelado) setAvisos(ehIPhone() && !emModoApp() ? 'instalar' : 'indisponivel');
        return;
      }
      try {
        const reg = await registroDoServiceWorker();
        if (Notification.permission === 'denied') {
          if (!cancelado) setAvisos('bloqueado');
          return;
        }
        const sub = await reg.pushManager.getSubscription();
        let meu = false;
        if (sub) {
          const r = await fetch(`/api/push/inscrever?endpoint=${encodeURIComponent(sub.endpoint)}`, { cache: 'no-store' });
          meu = r.ok && !!(await r.json()).inscrito;
        }
        if (!cancelado) setAvisos(meu ? 'ligado' : 'desligado');
      } catch {
        if (!cancelado) setAvisos('indisponivel');
      }
    })();
    return () => {
      cancelado = true;
    };
  }, []);

  const instalar = useCallback(async () => {
    const e = eventoInstalacao;
    if (!e) return;
    await e.prompt();
    await e.userChoice.catch(() => null);
    eventoInstalacao = null; // o navegador só deixa usar uma vez
    avisar();
  }, []);

  const ligarAvisos = useCallback(async () => {
    setOcupado(true);
    setMensagem('');
    try {
      const permissao = await Notification.requestPermission();
      if (permissao !== 'granted') {
        setAvisos(permissao === 'denied' ? 'bloqueado' : 'desligado');
        setMensagem(
          permissao === 'denied'
            ? 'O navegador bloqueou os avisos. Libere nas configurações do site e tente de novo.'
            : 'Você não permitiu os avisos.'
        );
        return;
      }
      const r = await fetch('/api/push/chave', { cache: 'no-store' });
      if (!r.ok) throw new Error('chave');
      const { chave } = await r.json();
      const reg = await registroDoServiceWorker();
      // Inscrição nova, sempre: se havia uma antiga (de outra chave ou outro usuário), sai.
      await (await reg.pushManager.getSubscription())?.unsubscribe();
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: chaveParaBytes(chave) });
      const salvou = await fetch('/api/push/inscrever', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription: sub.toJSON() }),
      });
      if (!salvou.ok) {
        await sub.unsubscribe().catch(() => {});
        throw new Error('salvar');
      }
      setAvisos('ligado');
      setMensagem('Avisos ligados neste celular.');
    } catch {
      setAvisos('desligado');
      setMensagem('Não foi possível ligar os avisos. Tente de novo.');
    } finally {
      setOcupado(false);
    }
  }, []);

  const desligarAvisos = useCallback(async () => {
    setOcupado(true);
    setMensagem('');
    try {
      const reg = await registroDoServiceWorker();
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await fetch('/api/push/inscrever', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        }).catch(() => {});
        await sub.unsubscribe();
      }
      setAvisos('desligado');
      setMensagem('Avisos desligados neste celular.');
    } catch {
      setMensagem('Não foi possível desligar os avisos. Tente de novo.');
    } finally {
      setOcupado(false);
    }
  }, []);

  const enviarTeste = useCallback(async () => {
    setOcupado(true);
    setMensagem('');
    try {
      const r = await fetch('/api/push/teste', { method: 'POST' });
      const d = await r.json().catch(() => ({}));
      setMensagem(r.ok ? 'Aviso de teste enviado. Ele deve aparecer em instantes.' : d.error || 'Não foi possível enviar o teste.');
    } catch {
      setMensagem('Sem conexão. Tente de novo.');
    } finally {
      setOcupado(false);
    }
  }, []);

  return { instalacao, instalar, avisos, ocupado, mensagem, ligarAvisos, desligarAvisos, enviarTeste };
}

export const AppCelularContext = createContext<AppCelular | null>(null);

export function useAppCelular(): AppCelular | null {
  return useContext(AppCelularContext);
}
