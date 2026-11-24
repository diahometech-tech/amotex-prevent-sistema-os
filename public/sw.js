// Service worker do app Amotex Prevent: SÓ trata aviso (push) e o toque na
// notificação. NÃO guarda página, script nem resposta de API em cache: um
// service worker com cache já serviu versão velha depois de deploy neste
// sistema. O `fetch` abaixo existe só porque alguns navegadores exigem um
// ouvinte para oferecer "Instalar o app"; ele não responde nada, então toda
// requisição segue direto para a rede, como se o service worker não existisse.
// Não mexe na fila offline de foto/assinatura (src/lib/fila-envio.ts): ela
// roda na página, com IndexedDB.

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', () => {});

self.addEventListener('push', (event) => {
  let dados = {};
  try {
    if (event.data) dados = event.data.json();
  } catch (e) {
    dados = { corpo: event.data ? event.data.text() : '' };
  }
  const titulo = dados.titulo || 'Amotex Prevent';
  event.waitUntil(
    self.registration.showNotification(titulo, {
      body: dados.corpo || '',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: dados.tag || undefined,
      renotify: !!dados.tag,
      data: { url: dados.url || '/' },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const alvo = new URL((event.notification.data && event.notification.data.url) || '/', self.location.origin);
  event.waitUntil(
    (async () => {
      const janelas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const janela of janelas) {
        if (new URL(janela.url).origin !== alvo.origin) continue;
        // Com o app aberto: leva essa janela para a OS e traz para frente.
        if ('navigate' in janela) {
          try {
            await janela.navigate(alvo.href);
          } catch (e) {
            // sem permissão para navegar: só foca
          }
        }
        if ('focus' in janela) return janela.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(alvo.href);
    })()
  );
});
